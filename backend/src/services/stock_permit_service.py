"""إذن إضافة / إذن صرف — standalone stock documents (B5).

Adds or removes stock for reasons that are not a trade: a count adjustment, goods back from a
workshop, a sample out, an internal issue. Posts through `stock_service.post_movement` like every
other stock write, so No-Negative-Stock (Principle XI) applies here exactly as it does to a sale —
an administrative document is still not allowed to invent stock.

Costs: a receipt carries the cost the person adding the stock types (only they know what it was
worth); an issue is costed from the configured costing method, because nobody invents a cost for
stock going out. Quantity-only as far as the ledger is concerned, like manufacturing and wastage —
the cost is stored for the stock reports, not posted to the accounts.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sqlalchemy.orm import selectinload

from src.services import numbering

from src.core import clock
from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.stock import LocationKind, StockDirection
from src.models.stock_permit import PermitKind, StockPermit, StockPermitLine
from src.models.warehouse import Warehouse
from src.services import batch_service
from src.services import audit_service, costing_service, stock_service

ZERO_QTY = to_qty(0)

_PREFIX = {PermitKind.receipt: "ADD", PermitKind.issue: "ISS",
           PermitKind.opening: "OPEN"}
_MOVEMENT = {PermitKind.receipt: ("permit_in", StockDirection.in_),
             PermitKind.issue: ("permit_out", StockDirection.out),
             # A distinct movement type so the item card says «أول المدة» rather than passing the
             # opening off as a receipt that never happened.
             PermitKind.opening: ("opening_in", StockDirection.in_)}


class StockPermitError(Exception):
    """The permit cannot be posted as asked."""


def _doc_number(db: Session, kind: PermitKind) -> str:
    return numbering.next_document_number(
        db, StockPermit, _PREFIX[kind], where=StockPermit.kind == kind)


def create_permit(
    db: Session, *, kind: str, warehouse_id: int, lines: list[dict],
    actor_user_id: int, reason: str | None = None, notes: str | None = None,
    permit_date: date | None = None,
) -> StockPermit:
    try:
        permit_kind = PermitKind(kind)
    except ValueError as exc:
        raise StockPermitError("نوع الإذن غير صحيح.") from exc
    if not lines:
        raise StockPermitError("لازم سطر واحد على الأقل.")
    if db.get(Warehouse, warehouse_id) is None:
        raise StockPermitError("المخزن غير موجود.")

    built: list[tuple[Item, object, object, object]] = []
    for raw in lines:
        item = db.get(Item, raw.get("item_id"))
        if item is None:
            raise StockPermitError("صنف غير موجود.")
        quantity = to_qty(raw.get("quantity") or 0)
        if quantity <= ZERO_QTY:
            raise StockPermitError(f"كمية «{item.name}» لازم تكون أكبر من صفر.")
        if permit_kind in (PermitKind.receipt, PermitKind.opening):
            raw_cost = raw.get("unit_cost")
            cost = to_money(raw_cost) if raw_cost not in (None, "") \
                else costing_service.unit_cost(db, item.id)
        else:
            # Stock going out is worth what it cost us, not what someone types.
            cost = costing_service.unit_cost(db, item.id)
        if cost < ZERO:
            raise StockPermitError("التكلفة لا تكون بالسالب.")
        # (011) A perishable item lives in expiry lots, and stock that moves without its lot
        # moving breaks Σ(batch) == on-hand. Bringing goods IN has to say which lot they are;
        # sending them out does not, because FEFO picks — earliest expiry first, same as a sale.
        expiry = raw.get("expiry_date")
        if getattr(item, "is_perishable", False)                 and permit_kind in (PermitKind.receipt, PermitKind.opening) and not expiry:
            raise StockPermitError(
                f"«{item.name}» صنف له صلاحية — لازم تكتب تاريخ صلاحية البضاعة الداخلة.")
        built.append((item, quantity, cost, expiry))

    permit = StockPermit(
        document_number=_doc_number(db, permit_kind), kind=permit_kind,
        warehouse_id=warehouse_id, permit_date=permit_date, reason=reason, notes=notes,
        total_cost=ZERO, actor_user_id=actor_user_id,
    )
    db.add(permit)
    db.flush()

    movement_type, direction = _MOVEMENT[permit_kind]
    total = ZERO
    for item, quantity, cost, expiry in built:
        line_cost = to_money(quantity * cost)
        total = to_money(total + line_cost)
        line = StockPermitLine(
            permit_id=permit.id, item_id=item.id, quantity=quantity,
            unit_cost=cost, line_cost=line_cost, expiry_date=expiry,
        )
        db.add(line)
        db.flush()
        # Raises StockError if this line would go negative — and because the whole permit is one
        # transaction, that rolls back the lines already posted with it.
        mv = stock_service.post_movement(
            db, item_id=item.id, location_kind=LocationKind.warehouse, location_id=warehouse_id,
            movement_type=movement_type, direction=direction, quantity=quantity,
            actor_user_id=actor_user_id, source_doc_type="stock_permit", source_doc_id=permit.id,
        )
        line.stock_movement_id = mv.id

        # The lot side of the same movement. Both halves move together or the invariant drifts.
        if getattr(item, "is_perishable", False):
            try:
                if permit_kind in (PermitKind.receipt, PermitKind.opening):
                    batch_service.add_to_lot(
                        db, item_id=item.id, location_kind=LocationKind.warehouse,
                        location_id=warehouse_id, expiry_date=expiry, quantity=quantity,
                        document_type="stock_permit", document_id=permit.id,
                        actor_user_id=actor_user_id)
                else:
                    # FEFO, and it records every lot it drew from — which is what the reversal reads.
                    taken = batch_service.consume_fefo(
                        db, item_id=item.id, location_kind=LocationKind.warehouse,
                        location_id=warehouse_id, quantity=quantity,
                        document_type="stock_permit", document_id=permit.id,
                        actor_user_id=actor_user_id)
                    # One line reverses into one lot, so remember the earliest it emptied.
                    if taken:
                        line.expiry_date = min(e for e, _q in taken)
            except batch_service.BatchError as exc:
                raise StockPermitError(str(exc)) from exc

    permit.total_cost = total
    db.flush()
    audit_service.record(
        db, action="stock_permit.create", actor_user_id=actor_user_id,
        entity_type="stock_permit", entity_id=permit.id,
        after={"doc": permit.document_number, "kind": permit_kind.value, "cost": str(total)},
    )
    return permit


def reverse_permit(db: Session, *, permit_id: int, actor_user_id: int) -> StockPermit:
    original = db.get(StockPermit, permit_id)
    if original is None:
        raise StockPermitError("الإذن غير موجود.")
    if original.reverses_id is not None:
        raise StockPermitError("ما ينفعش تعكس إذن عكسي.")
    already = db.scalar(select(StockPermit).where(StockPermit.reverses_id == permit_id))
    if already is not None:
        raise StockPermitError("الإذن اتعكس قبل كده.")

    # An opening reverses as an issue: what went in has to come out, and the reversal is a
    # correction of the opening, not a second opening.
    mirror_kind = (PermitKind.issue
                   if original.kind in (PermitKind.receipt, PermitKind.opening)
                   else PermitKind.receipt)
    reversal = StockPermit(
        document_number=_doc_number(db, mirror_kind), kind=mirror_kind,
        warehouse_id=original.warehouse_id, permit_date=original.permit_date,
        reason=f"عكس {original.document_number}", notes=original.notes,
        total_cost=original.total_cost, reverses_id=original.id, actor_user_id=actor_user_id,
    )
    db.add(reversal)
    db.flush()

    for line in original.lines:
        mirror = StockPermitLine(
            permit_id=reversal.id, item_id=line.item_id, quantity=line.quantity,
            unit_cost=line.unit_cost, line_cost=line.line_cost, expiry_date=line.expiry_date,
        )
        db.add(mirror)
        db.flush()
        if line.stock_movement_id is not None:
            mv = stock_service.reverse_movement(
                db, original_id=line.stock_movement_id, actor_user_id=actor_user_id)
            mirror.stock_movement_id = mv.id

        # (011) The lot follows the stock, on the way back as on the way out. The original line
        # wrote down which lot it touched precisely so this does not have to guess a date — the
        # same reason a sale records what FEFO drew from.
        item = db.get(Item, line.item_id)
        if item is not None and getattr(item, "is_perishable", False) and line.expiry_date:
            try:
                if original.kind in (PermitKind.receipt, PermitKind.opening):
                    # An addition is undone by taking the goods back OUT of the lot it filled.
                    batch_service.consume_fefo(
                        db, item_id=item.id, location_kind=LocationKind.warehouse,
                        location_id=original.warehouse_id, quantity=line.quantity,
                        document_type="stock_permit", document_id=reversal.id,
                        actor_user_id=actor_user_id)
                else:
                    batch_service.restore_for_return(
                        db, item_id=item.id, location_kind=LocationKind.warehouse,
                        location_id=original.warehouse_id, expiry_date=line.expiry_date,
                        quantity=line.quantity, actor_user_id=actor_user_id)
            except batch_service.BatchError as exc:
                raise StockPermitError(str(exc)) from exc

    db.flush()
    audit_service.record(
        db, action="stock_permit.reverse", actor_user_id=actor_user_id,
        entity_type="stock_permit", entity_id=reversal.id,
        after={"doc": reversal.document_number, "reverses": original.document_number},
    )
    return reversal


def list_permits(
    db: Session, *, kind: str | None = None, warehouse_id: int | None = None,
    date_from: str | None = None, date_to: str | None = None,
) -> list[StockPermit]:
    stmt = select(StockPermit).options(selectinload(StockPermit.lines))
    if kind:
        stmt = stmt.where(StockPermit.kind == PermitKind(kind))
    if warehouse_id:
        stmt = stmt.where(StockPermit.warehouse_id == warehouse_id)
    if date_from:
        stmt = stmt.where(StockPermit.created_at >= clock.day_start_utc(date_from))
    if date_to:
        stmt = stmt.where(StockPermit.created_at < clock.day_end_utc(date_to))
    return list(db.scalars(stmt.order_by(StockPermit.id.desc())).all())


def get_permit(db: Session, permit_id: int) -> StockPermit:
    permit = db.scalar(
        select(StockPermit).options(selectinload(StockPermit.lines))
        .where(StockPermit.id == permit_id)
    )
    if permit is None:
        raise StockPermitError("الإذن غير موجود.")
    return permit
