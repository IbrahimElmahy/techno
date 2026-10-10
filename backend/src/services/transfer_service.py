from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import delete as sa_delete, func, select, update as sa_update
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import to_qty
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection, StockDoc
from src.models.transfer import (
    StockTransfer, StockTransferLine, TransferRoute, TransferStatus)
from src.models.user import User
from src.models.warehouse import Custody, Warehouse
from src.models.catalog import Item
from src.auth.branch_scope import branch_for
from src.services import (
    audit_service, batch_service, serial_service, stock_service,
)

MOVEMENT_DOC = StockDoc.TRANSFER

_ROUTE_KINDS = {
    TransferRoute.central_to_branch: (LocationKind.warehouse, LocationKind.warehouse),
    TransferRoute.central_to_rep: (LocationKind.warehouse, LocationKind.custody),
    TransferRoute.rep_to_rep: (LocationKind.custody, LocationKind.custody),
    TransferRoute.rep_to_central: (LocationKind.custody, LocationKind.warehouse),
}


class TransferError(Exception):
    pass


class TransferDenied(Exception):
    pass


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, StockTransfer, "TRF")


def _location_branch(db: Session, kind: LocationKind, location_id: int) -> int | None:
    if kind == LocationKind.warehouse:
        wh = db.get(Warehouse, location_id)
        return wh.branch_id if wh else None
    custody = db.get(Custody, location_id)
    if custody and custody.rep_id:
        rep = db.get(User, custody.rep_id)
        return rep.branch_id if rep else None
    if custody and custody.warehouse_id:
        wh = db.get(Warehouse, custody.warehouse_id)
        return wh.branch_id if wh else None
    return None


def initiate(db, *, item_id, quantity, route: TransferRoute, source_kind, source_id,
             dest_kind, dest_id, initiated_by, transfer_date=None,
             client_uuid: str | None = None,
             statement1: str | None = None, notes: str | None = None,
             external_document_number: str | None = None) -> StockTransfer:
    want_src, want_dst = _ROUTE_KINDS[route]
    if source_kind != want_src or dest_kind != want_dst:
        raise TransferError("نوع التحويل هذا غير متاح بين هذين الموقعين.")
    qty = Decimal(quantity)
    if qty <= 0:
        raise TransferError("يجب أن تكون كمية التحويل أكبر من صفر.")
    if source_kind == dest_kind and source_id == dest_id:
        raise TransferError("يجب أن يكون المصدر والوجهة موقعين مختلفين.")
    transfer = StockTransfer(
        document_number=_doc_number(db), item_id=item_id, quantity=Decimal(quantity), route=route,
        source_location_kind=source_kind, source_location_id=source_id,
        dest_location_kind=dest_kind, dest_location_id=dest_id,
        status=TransferStatus.pending, initiated_by=initiated_by,
        transfer_date=transfer_date, client_uuid=client_uuid,
        statement1=statement1, notes=notes, external_document_number=external_document_number,
        branch_id=branch_for(db, actor_user_id=initiated_by,
                             location_kind=source_kind, location_id=source_id),
    )
    db.add(transfer)
    db.flush()
    return transfer


def _move(db, transfer, *, item_id: int, from_kind, from_id: int, to_kind, to_id: int,
          quantity, actor_user_id: int, tracking_actor: int | None = None):
    out_mv = stock_service.post_movement(
        db, item_id=item_id, location_kind=from_kind, location_id=from_id,
        movement_type="transfer_out", direction=StockDirection.out, quantity=quantity,
        actor_user_id=actor_user_id, source_doc_type=MOVEMENT_DOC, source_doc_id=transfer.id,
    )
    in_mv = stock_service.post_movement(
        db, item_id=item_id, location_kind=to_kind, location_id=to_id,
        movement_type="transfer_in", direction=StockDirection.in_, quantity=quantity,
        actor_user_id=actor_user_id, source_doc_type=MOVEMENT_DOC, source_doc_id=transfer.id,
    )
    item = db.get(Item, item_id)
    if item is not None:
        who = tracking_actor or actor_user_id
        if getattr(item, "is_serialized", False):
            serial_service.relocate(
                db, item=item, from_kind=from_kind, from_id=from_id,
                to_kind=to_kind, to_id=to_id, quantity=quantity,
                transfer_id=transfer.id, actor_user_id=who)
        if getattr(item, "is_perishable", False):
            batch_service.relocate(
                db, item_id=item.id, from_kind=from_kind, from_id=from_id,
                to_kind=to_kind, to_id=to_id, quantity=quantity,
                transfer_id=transfer.id, actor_user_id=who)
    return out_mv, in_mv


def approve(db, *, transfer_id: int, approver_role: RoleName, approver_branch_id: int | None,
            approver_user_id: int, is_admin: bool) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل غير موجود.")
    if transfer.status != TransferStatus.pending:
        raise TransferError("لا يمكن اعتماد إذن معتمد أو مرفوض مرة أخرى.")

    src_branch = _location_branch(db, transfer.source_location_kind, transfer.source_location_id)
    if src_branch is None:
        if not is_admin:
            raise TransferDenied("يتطلب التحويل من مخزن مركزي صلاحية الإدارة.")
    elif not (is_admin or (approver_role == RoleName.branch_manager and approver_branch_id == src_branch)):
        raise TransferDenied("الاعتماد لمدير فرع المصدر فقط.")

    lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id)).all()
    moving = ([(ln, ln.item_id, ln.quantity) for ln in lines] if lines
              else [(None, transfer.item_id, transfer.quantity)])
    if not moving:
        raise TransferError("لا توجد أصناف في الإذن — ارفضه بدلاً من اعتماده.")

    first_out = first_in = None
    for line, item_id, quantity in moving:
        out_mv, in_mv = _move(
            db, transfer, item_id=item_id,
            from_kind=transfer.source_location_kind, from_id=transfer.source_location_id,
            to_kind=transfer.dest_location_kind, to_id=transfer.dest_location_id,
            quantity=quantity, actor_user_id=approver_user_id,
            tracking_actor=transfer.approved_by or transfer.initiated_by)
        if line is not None:
            line.out_movement_id = out_mv.id
            line.in_movement_id = in_mv.id
        if first_out is None:
            first_out, first_in = out_mv, in_mv

    out_mv, in_mv = first_out, first_in

    transfer.status = TransferStatus.approved
    transfer.approved_by = approver_user_id
    transfer.approved_at = datetime.utcnow()
    transfer.out_movement_id = out_mv.id
    transfer.in_movement_id = in_mv.id
    db.flush()
    audit_service.record(db, action="transfer.approve", actor_user_id=approver_user_id,
                         entity_type="stock_transfer", entity_id=transfer.id)
    return transfer


def _drop_movements(db, transfer, lines) -> None:
    from src.models.stock import StockMovement

    for ln in lines:
        ln.out_movement_id = None
        ln.in_movement_id = None
    transfer.out_movement_id = None
    transfer.in_movement_id = None
    db.flush()

    db.execute(sa_delete(StockMovement).where(
        StockMovement.source_doc_type == MOVEMENT_DOC,
        StockMovement.source_doc_id == transfer.id))


def delete(db, *, transfer_id: int, actor_user_id: int) -> None:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل غير موجود.")

    lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id)).all()

    if transfer.status == TransferStatus.approved:
        for ln in lines:
            item = db.get(Item, ln.item_id)
            if item is None:
                continue
            if getattr(item, "is_serialized", False):
                serial_service.relocate(
                    db, item=item,
                    from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                    to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                    quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)
            if getattr(item, "is_perishable", False):
                batch_service.relocate(
                    db, item_id=item.id,
                    from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                    to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                    quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)

        _drop_movements(db, transfer, lines)

    doc = transfer.document_number
    db.execute(sa_delete(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id))
    db.delete(transfer)
    db.flush()
    audit_service.record(db, action="transfer.delete", actor_user_id=actor_user_id,
                         entity_type="stock_transfer", entity_id=transfer_id,
                         before={"doc": doc})


def _refuse_if_dest_goes_negative(db, transfer, lines) -> None:
    from src.models.stock import LocationKind as _LK

    if transfer.dest_location_kind != _LK.warehouse:
        return
    short = []
    for ln in lines:
        on_hand = Decimal(str(stock_service.on_hand(
            db, ln.item_id, transfer.dest_location_kind, transfer.dest_location_id)))
        after = on_hand - Decimal(str(ln.quantity))
        if after < 0:
            item = db.get(Item, ln.item_id)
            short.append(f"«{item.name if item else ln.item_id}» سينخفض إلى {after}")
    if short:
        raise TransferError(
            "سيجعل الإلغاء رصيد الوجهة سالباً — أي أن البضاعة وصلت وبيعت، فلا يمكن "
            "اعتبارها لم تصل: " + "، ".join(short[:5])
            + (f" و{len(short) - 5} أخرى" if len(short) > 5 else "")
            + ". سجّل إذن إرجاع بالكمية الموجودة حالياً، أو اضبط الجرد أولاً.")


def cancel(db, *, transfer_id: int, actor_user_id: int,
           reason: str | None = None) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل غير موجود.")
    if transfer.status != TransferStatus.approved:
        raise TransferError("لا يُلغى إلا الإذن المعتمد — أما المعلّق فيُرفض.")

    lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id)).all()
    _refuse_if_dest_goes_negative(db, transfer, lines)
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None:
            continue
        if getattr(item, "is_serialized", False):
            serial_service.relocate(
                db, item=item,
                from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)
        if getattr(item, "is_perishable", False):
            batch_service.relocate(
                db, item_id=item.id,
                from_kind=transfer.dest_location_kind, from_id=transfer.dest_location_id,
                to_kind=transfer.source_location_kind, to_id=transfer.source_location_id,
                quantity=ln.quantity, transfer_id=transfer.id, actor_user_id=actor_user_id)

    _drop_movements(db, transfer, lines)

    transfer.status = TransferStatus.reversed
    transfer.reject_reason = (reason or "أُلغي بعد الاعتماد")[:240]
    db.flush()
    audit_service.record(db, action="transfer.cancel", actor_user_id=actor_user_id,
                         entity_type="stock_transfer", entity_id=transfer.id,
                         after={"reason": reason})
    return transfer


def _route_of(source_kind, dest_kind) -> TransferRoute | None:
    for route, kinds in _ROUTE_KINDS.items():
        if kinds == (source_kind, dest_kind):
            return route
    return None


def _qty_by_item(pairs) -> dict[int, Decimal]:
    out: dict[int, Decimal] = {}
    for item_id, quantity in pairs:
        out[item_id] = to_qty(out.get(item_id, to_qty(0)) + to_qty(quantity))
    return out


def _item_name(db, item_id: int) -> str:
    item = db.get(Item, item_id)
    return item.name if item and item.name else f"صنف #{item_id}"


def _plan_revision(old: dict[int, Decimal], new: dict[int, Decimal],
                   old_src, old_dst, new_src, new_dst) -> list[tuple]:
    returns, extras = [], []
    if old_src == new_src and old_dst == new_dst:
        for item_id in list(old) + [i for i in new if i not in old]:
            diff = to_qty(new.get(item_id, to_qty(0)) - old.get(item_id, to_qty(0)))
            if diff < 0:
                returns.append((item_id, old_dst, old_src, to_qty(-diff), "return"))
            elif diff > 0:
                extras.append((item_id, new_src, new_dst, diff, "extra"))
    else:
        for item_id, quantity in old.items():
            returns.append((item_id, old_dst, old_src, quantity, "return"))
        for item_id, quantity in new.items():
            extras.append((item_id, new_src, new_dst, quantity, "extra"))
    return returns + extras


def _refuse_short_moves(db, plan: list[tuple]) -> None:
    balance: dict[tuple, Decimal] = {}

    def have(item_id, loc) -> Decimal:
        key = (item_id, loc)
        if key not in balance:
            balance[key] = to_qty(stock_service.on_hand(db, item_id, loc[0], loc[1]))
        return balance[key]

    short = []
    for item_id, frm, to, quantity, kind in plan:
        available = have(item_id, frm)
        if available < quantity:
            where = stock_service._label(db, frm[0], frm[1])
            name = _item_name(db, item_id)
            if kind == "return":
                short.append(f"«{name}»: المطلوب إرجاعه من {where} {quantity} "
                             f"والموجود فيه حالياً {max(available, to_qty(0))}")
            else:
                short.append(f"«{name}»: المطلوب تحويله من {where} {quantity} "
                             f"والمتاح فيه {max(available, to_qty(0))}")
            continue
        balance[(item_id, frm)] = to_qty(available - quantity)
        balance[(item_id, to)] = to_qty(have(item_id, to) + quantity)
    if short:
        raise TransferError(
            "تعذّر حفظ التعديل ولم تُرحَّل أي حركة — "
            + "؛ ".join(short[:8])
            + (f" و{len(short) - 8} أخرى" if len(short) > 8 else "")
            + ". إن كان جزء من البضاعة قد بيع من الوجهة فلا يمكن إرجاعه؛ "
              "اجعل الكمية في الإذن لا تقل عن المباع.")


def revise(db, *, transfer_id: int, lines, actor_user_id: int,
           source_kind=None, source_id: int | None = None,
           dest_kind=None, dest_id: int | None = None,
           transfer_date=None, texts: dict | None = None) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل غير موجود.")
    if transfer.status != TransferStatus.approved:
        raise TransferError("التعديل بترحيل الفروق متاح للإذن المعتمد فقط.")

    wanted = []
    for item_id, quantity in lines:
        qty = to_qty(quantity)
        if qty <= 0:
            raise TransferError(
                f"كمية «{_item_name(db, item_id)}» يجب أن تكون أكبر من صفر — "
                "إن لم تكن تريده فاحذف السطر.")
        wanted.append((int(item_id), qty))
    if not wanted:
        raise TransferError(
            "يجب أن يبقى في الإذن صنف واحد على الأقل — لإلغاء الإذن كله استخدم «إلغاء».")
    new = _qty_by_item(wanted)

    old_lines = db.scalars(select(StockTransferLine).where(
        StockTransferLine.transfer_id == transfer.id).order_by(StockTransferLine.id)).all()
    old = (_qty_by_item((ln.item_id, ln.quantity) for ln in old_lines) if old_lines
           else _qty_by_item([(transfer.item_id, transfer.quantity)]))

    old_src = (transfer.source_location_kind, transfer.source_location_id)
    old_dst = (transfer.dest_location_kind, transfer.dest_location_id)
    new_src = ((source_kind, int(source_id)) if source_kind is not None and source_id is not None
               else old_src)
    new_dst = ((dest_kind, int(dest_id)) if dest_kind is not None and dest_id is not None
               else old_dst)
    moved = new_src != old_src or new_dst != old_dst
    if new_src == new_dst:
        raise TransferError("يجب أن يكون المصدر والوجهة موقعين مختلفين.")
    route = _route_of(new_src[0], new_dst[0]) if moved else transfer.route
    if route is None:
        raise TransferError("نوع التحويل هذا غير متاح بين هذين الموقعين.")

    def snapshot(src, dst, qtys, when, txt) -> dict:
        return {
            "source": f"{getattr(src[0], 'value', src[0])}:{src[1]}",
            "dest": f"{getattr(dst[0], 'value', dst[0])}:{dst[1]}",
            "transfer_date": str(when) if when else None,
            "lines": [{"item_id": i, "quantity": str(q)} for i, q in qtys.items()],
            **txt,
        }

    old_texts = {f: getattr(transfer, f, None) for f in _TEXT_FIELDS}
    new_texts = dict(old_texts)
    for field in _TEXT_FIELDS:
        if texts is not None and field in texts:
            new_texts[field] = (texts[field] or "").strip() or None
    old_date = transfer.transfer_date
    new_date = transfer_date if transfer_date is not None else old_date

    plan = _plan_revision(old, new, old_src, old_dst, new_src, new_dst)
    if not plan and not moved and new_texts == old_texts and new_date == old_date:
        return transfer

    _refuse_short_moves(db, plan)

    before = snapshot(old_src, old_dst, old, old_date, old_texts)
    for field, value in new_texts.items():
        setattr(transfer, field, value)
    if new_date != old_date:
        transfer.transfer_date = new_date
    if moved:
        transfer.source_location_kind, transfer.source_location_id = new_src
        transfer.dest_location_kind, transfer.dest_location_id = new_dst
        transfer.route = route
        transfer.branch_id = branch_for(db, actor_user_id=transfer.initiated_by,
                                        location_kind=new_src[0], location_id=new_src[1])
    db.flush()

    if new_date != old_date and new_date is not None:
        from src.models.stock import StockMovement

        db.execute(sa_update(StockMovement).where(
            StockMovement.source_doc_type == MOVEMENT_DOC,
            StockMovement.source_doc_id == transfer.id).values(movement_date=new_date))

    posted: dict[int, tuple] = {}
    moves = []
    for item_id, frm, to, quantity, kind in plan:
        out_mv, in_mv = _move(
            db, transfer, item_id=item_id, from_kind=frm[0], from_id=frm[1],
            to_kind=to[0], to_id=to[1], quantity=quantity, actor_user_id=actor_user_id)
        if kind == "extra":
            posted[item_id] = (out_mv.id, in_mv.id)
        moves.append({"item_id": item_id, "kind": kind, "quantity": str(quantity),
                      "from": f"{getattr(frm[0], 'value', frm[0])}:{frm[1]}",
                      "to": f"{getattr(to[0], 'value', to[0])}:{to[1]}"})

    kept: dict[int, StockTransferLine] = {}
    for ln in old_lines:
        if ln.item_id in new and ln.item_id not in kept:
            kept[ln.item_id] = ln
            ln.quantity = new[ln.item_id]
            if ln.item_id in posted and moved:
                ln.out_movement_id, ln.in_movement_id = posted[ln.item_id]
        else:
            db.delete(ln)
    for item_id, quantity in new.items():
        if item_id in kept:
            continue
        out_id, in_id = posted.get(item_id, (None, None))
        db.add(StockTransferLine(transfer_id=transfer.id, item_id=item_id, quantity=quantity,
                                 out_movement_id=out_id, in_movement_id=in_id))
    head_item = wanted[0][0]
    transfer.item_id = head_item
    transfer.quantity = new[head_item]
    if moved and head_item in posted:
        transfer.out_movement_id, transfer.in_movement_id = posted[head_item]
    db.flush()
    db.expire(transfer, ["lines"])

    audit_service.record(
        db, action="transfer.revise", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=transfer.id,
        before=before,
        after={**snapshot(new_src, new_dst, new, new_date, new_texts), "moves": moves})
    return transfer


def _pending(db, transfer_id: int) -> StockTransfer:
    transfer = db.get(StockTransfer, transfer_id)
    if transfer is None:
        raise TransferError("إذن التحويل غير موجود.")
    if transfer.status != TransferStatus.pending:
        raise TransferError("هذا الإذن ليس قيد الاعتماد — لا يمكن تعديله.")
    return transfer


def add_line(db, *, transfer_id: int, item_id: int, quantity,
             actor_user_id: int | None = None) -> StockTransferLine:
    transfer = _pending(db, transfer_id)
    qty = to_qty(quantity)
    if qty <= 0:
        raise TransferError("يجب أن تكون الكمية أكبر من صفر.")
    line = StockTransferLine(transfer_id=transfer.id, item_id=item_id, quantity=qty)
    db.add(line)
    db.flush()
    audit_service.record(
        db, action="transfer.line_add", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=transfer.id,
        after={"item_id": item_id, "quantity": str(qty)})
    return line


def set_line_quantity(db, *, line_id: int, quantity,
                      actor_user_id: int | None = None) -> StockTransferLine:
    line = db.get(StockTransferLine, line_id)
    if line is None:
        raise TransferError("السطر غير موجود.")
    _pending(db, line.transfer_id)
    qty = to_qty(quantity)
    if qty <= 0:
        raise TransferError("يجب أن تكون الكمية أكبر من صفر — إن لم تكن تريده فاحذف السطر.")
    was = str(line.quantity)
    line.quantity = qty
    db.flush()
    audit_service.record(
        db, action="transfer.line_qty", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=line.transfer_id,
        before={"item_id": line.item_id, "quantity": was},
        after={"item_id": line.item_id, "quantity": str(qty)})
    return line


_TEXT_FIELDS = ("statement1", "external_document_number", "notes")


def set_texts(db, *, transfer_id: int, values: dict,
              actor_user_id: int | None = None) -> StockTransfer:
    transfer = _pending(db, transfer_id)
    before, after = {}, {}
    for field in _TEXT_FIELDS:
        if field not in values:
            continue
        new = (values[field] or "").strip() or None
        old = getattr(transfer, field, None)
        if new == old:
            continue
        before[field], after[field] = old, new
        setattr(transfer, field, new)
    if after:
        db.flush()
        audit_service.record(
            db, action="transfer.texts", actor_user_id=actor_user_id,
            entity_type="stock_transfer", entity_id=transfer.id,
            before=before, after=after)
    return transfer


def remove_line(db, *, line_id: int, actor_user_id: int | None = None) -> None:
    line = db.get(StockTransferLine, line_id)
    if line is None:
        raise TransferError("السطر غير موجود.")
    _pending(db, line.transfer_id)
    audit_service.record(
        db, action="transfer.line_remove", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=line.transfer_id,
        before={"item_id": line.item_id, "quantity": str(line.quantity)})
    db.delete(line)
    db.flush()


def reject(db, *, transfer_id: int, actor_user_id: int, reason: str | None = None) -> StockTransfer:
    transfer = _pending(db, transfer_id)
    transfer.status = TransferStatus.rejected
    transfer.approved_by = actor_user_id
    transfer.approved_at = datetime.utcnow()
    if reason:
        transfer.reject_reason = reason[:240]
    db.flush()
    audit_service.record(
        db, action="transfer.reject", actor_user_id=actor_user_id,
        entity_type="stock_transfer", entity_id=transfer.id,
        after={"doc": transfer.document_number, "reason": reason},
    )
    return transfer
