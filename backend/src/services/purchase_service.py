from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import ZERO, to_factor, to_money, to_qty
from src.lib import entry_text
from src.lib import discounts
from src.models.catalog import Item
from src.models.ledger import Account, Direction, PartnerKind
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection, StockDoc
from src.models.supplier import Supplier
from src.services import (
    account_resolver,
    supplier_service,
    audit_service,
    ledger_service,
    sales_service,
    stock_service,
    tax_service,
    uom_service,
)
from src.services.ledger_service import LineInput
from src.services.uom_service import UomError
from src.auth.branch_scope import branch_for


class PurchaseError(Exception):
    pass


@dataclass(frozen=True)
class PurchaseLine:
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    unit: str | None = None
    warehouse_id: int | None = None
    discount_pct: Decimal | None = None
    fixed_discount_pct: Decimal | None = None
    variable_discount_pct: Decimal | None = None


def _doc_number(db: Session, model, prefix: str) -> str:
    return numbering.next_document_number(db, model, prefix)


def create_purchase(
    db: Session,
    *,
    supplier_id: int,
    location_kind: LocationKind,
    location_id: int,
    cash_amount: Decimal,
    credit_amount: Decimal | None,
    lines: list[PurchaseLine],
    actor_role: RoleName,
    actor_user_id: int,
    cash_account_id: int | None = None,
    rep_id: int | None = None,
    expense_account_id: int | None = None,
    external_document_number: str | None = None,
    notes: str | None = None,
    statement1: str | None = None,
    statement2: str | None = None,
    statement3: str | None = None,
    purchase_date=None,
    variable_discount_pct: Decimal = ZERO,
    replace_invoice_id: int | None = None,
    cost_center_id: int | None = None,
    cost_center_distribution: dict | None = None,
) -> PurchaseInvoice:
    if not lines:
        raise PurchaseError("يجب أن تتضمن فاتورة الشراء صنفاً واحداً على الأقل.")
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise PurchaseError("المورد غير موجود.")
    supplier_acc = supplier_service.require_account(db, supplier_id)

    fixed = sales_service.fixed_discount_pct(db)
    variable = Decimal(variable_discount_pct)
    combined = discounts.combine(fixed, variable)
    if variable < ZERO or variable >= Decimal("100") or fixed < ZERO or fixed >= Decimal("100"):
        raise PurchaseError("يجب أن يكون كل خصم من صفر إلى أقل من ١٠٠٪.")

    gross = ZERO
    built: list[tuple[PurchaseLine, Decimal, Decimal, Decimal | None]] = []
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None:
            raise PurchaseError("الصنف المشترى غير موجود.")
        try:
            factor = uom_service.resolve_factor(db, item, ln.unit)
        except UomError as exc:
            raise PurchaseError(str(exc)) from exc
        line_disc = Decimal(ln.discount_pct) if getattr(ln, "discount_pct", None) is not None             else ZERO
        if line_disc < ZERO or line_disc >= Decimal("100"):
            raise PurchaseError("يجب أن يكون خصم السطر من صفر إلى أقل من ١٠٠٪.")
        line_before = Decimal(ln.quantity) * Decimal(ln.unit_price)
        line_total = to_money(line_before * (Decimal("1") - line_disc / Decimal("100")))
        gross += line_total
        built.append((ln, line_total, factor, line_disc))
    gross = to_money(gross)
    net = discounts.apply(gross, fixed, variable)
    tax = tax_service.tax_on(net, tax_service.vat_rate(db))
    total = to_money(net + tax)
    cash_amount = to_money(cash_amount)
    if credit_amount is None:
        credit_amount = total - cash_amount
    elif to_money(credit_amount) != total - cash_amount:
        raise PurchaseError(
            f"يجب أن يساوي النقدي + الآجل إجمالي فاتورة الشراء ({total})."
        )

    existing = db.get(PurchaseInvoice, replace_invoice_id) if replace_invoice_id else None
    if replace_invoice_id and existing is None:
        raise PurchaseError("فاتورة الشراء المراد تعديلها غير موجودة.")

    invoice = existing or PurchaseInvoice(
        document_number=_doc_number(db, PurchaseInvoice, "PINV"),
        supplier_id=supplier_id, location_kind=location_kind, location_id=location_id,
        gross=gross, fixed_discount_pct=fixed, variable_discount_pct=variable,
        combined_pct=combined, net=net, tax_amount=tax,
        total=total, cash_amount=to_money(cash_amount), credit_amount=to_money(credit_amount),
        ledger_entry_id=None, actor_user_id=actor_user_id,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind=location_kind, location_id=location_id),
        rep_id=rep_id, expense_account_id=expense_account_id,
        external_document_number=(external_document_number or None),
        notes=notes, statement1=statement1, statement2=statement2, statement3=statement3,
        purchase_date=purchase_date or date.today(),
        cost_center_id=cost_center_id,
    )
    if existing is not None:
        existing.cost_center_id = cost_center_id
        existing.supplier_id = supplier_id
        existing.location_kind = location_kind
        existing.location_id = location_id
        existing.gross = gross
        existing.fixed_discount_pct = fixed
        existing.variable_discount_pct = variable
        existing.combined_pct = combined
        existing.net = net
        existing.tax_amount = tax
        existing.total = total
        existing.cash_amount = to_money(cash_amount)
        existing.credit_amount = to_money(credit_amount)
        existing.ledger_entry_id = None
        existing.rep_id = rep_id
        existing.expense_account_id = expense_account_id
        existing.external_document_number = (external_document_number or None)
        existing.notes = notes
        existing.statement1 = statement1
        existing.statement2 = statement2
        existing.statement3 = statement3
        if purchase_date is not None:
            existing.purchase_date = purchase_date
        invoice.lines.clear()
    else:
        db.add(invoice)
    db.flush()
    for ln, line_total, factor, line_disc in built:
        base_qty = to_qty(Decimal(ln.quantity) * factor)
        line_kind, line_loc = ((LocationKind.warehouse, ln.warehouse_id)
                               if ln.warehouse_id is not None else (location_kind, location_id))
        stock_service.post_movement(
            db, item_id=ln.item_id, location_kind=line_kind, location_id=line_loc,
            movement_type="purchase_in", direction=StockDirection.in_, quantity=base_qty,
            actor_user_id=actor_user_id, source_doc_type=StockDoc.PURCHASE, source_doc_id=invoice.id,
        )
        invoice.lines.append(
            PurchaseInvoiceLine(item_id=ln.item_id, quantity=ln.quantity,
                                unit_price=to_money(ln.unit_price), line_total=line_total,
                                discount_pct=ln.discount_pct, unit=ln.unit, unit_factor=factor,
                                fixed_discount_pct=ln.fixed_discount_pct,
                                variable_discount_pct=ln.variable_discount_pct,
                                line_location_kind=line_kind, line_location_id=line_loc)
        )

    cash_acc = (account_resolver.explicit_treasury(db, cash_account_id)
                or account_resolver.resolve_cash_account(
                    db, role=actor_role, user_id=actor_user_id, branch_id=invoice.branch_id))
    expense_acc = account_resolver.purchases_expense_account(db, branch_id=invoice.branch_id)
    entry_lines = [LineInput(expense_acc.id, Direction.debit, total)]
    if to_money(cash_amount) > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.credit, to_money(cash_amount)))
    if to_money(credit_amount) > ZERO:
        entry_lines.append(LineInput(supplier_acc.account_id, Direction.credit, to_money(credit_amount)))
    elif to_money(credit_amount) < ZERO:
        entry_lines.append(LineInput(supplier_acc.account_id, Direction.debit, -to_money(credit_amount)))
    entry_lines = [ln for ln in entry_lines if to_money(ln.amount) > ZERO]
    if entry_lines:
        entry = ledger_service.post_entry(
            db, entry_type="purchase", actor_user_id=actor_user_id, lines=entry_lines,
            rep_id=rep_id, branch_id=invoice.branch_id,
            description=entry_text.purchase(invoice.document_number),
            entry_date=invoice.purchase_date,
            partner_kind=PartnerKind.supplier, partner_id=invoice.supplier_id,
            cost_center_id=invoice.cost_center_id,
            cost_center_distribution=cost_center_distribution,
        )
        invoice.ledger_entry_id = entry.id
        db.flush()
    audit_service.record(db,
                         action="purchase.edit" if replace_invoice_id else "purchase.create",
                         actor_user_id=actor_user_id,
                         entity_type="purchase_invoice", entity_id=invoice.id,
                         after={"total": str(total), "doc": invoice.document_number})
    return invoice


def _already_returned(db: Session, invoice_id: int) -> dict[int, Decimal]:
    rows = db.execute(
        select(PurchaseReturnLine.item_id, func.coalesce(func.sum(PurchaseReturnLine.quantity), 0))
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .where(PurchaseReturn.purchase_invoice_id == invoice_id,
               PurchaseReturn.reversed_at.is_(None))
        .group_by(PurchaseReturnLine.item_id)
    ).all()
    return {item_id: Decimal(qty) for item_id, qty in rows}


def return_purchase(
    db: Session,
    *,
    purchase_invoice_id: int,
    lines: list[tuple[int, Decimal]],
    actor_role: RoleName,
    actor_user_id: int,
    return_date: date | None = None,
    notes: str | None = None,
) -> PurchaseReturn:
    inv = db.get(PurchaseInvoice, purchase_invoice_id)
    if inv is None:
        raise PurchaseError("فاتورة الشراء غير موجودة.")
    purchased = {
        ln.item_id: (Decimal(ln.quantity), to_money(ln.unit_price), to_factor(ln.unit_factor),
                     Decimal(ln.discount_pct or 0))
        for ln in inv.lines
    }
    doc_pct = Decimal(getattr(inv, "combined_pct", 0) or 0)
    received_into = {
        ln.item_id: (ln.line_location_kind or inv.location_kind,
                     ln.line_location_id if ln.line_location_id is not None else inv.location_id)
        for ln in inv.lines
    }
    prior = _already_returned(db, purchase_invoice_id)

    value = ZERO
    for item_id, qty in lines:
        qty = Decimal(qty)
        if item_id not in purchased:
            raise PurchaseError("هذا الصنف ليس على فاتورة الشراء هذه أصلاً.")
        if prior.get(item_id, ZERO) + qty > purchased[item_id][0]:
            raise PurchaseError(
                f"بلغت مرتجعات هذه الفاتورة الكمية المشتراة — "
                f"المشترى {purchased[item_id][0]} والمرتجع سابقاً {prior.get(item_id, ZERO)}.")
        value += discounts.apply(qty * purchased[item_id][1], purchased[item_id][3])
    value = discounts.apply(value, doc_pct)

    cash_refund = to_money(value * to_money(inv.cash_amount) / to_money(inv.total)) if inv.total else ZERO
    credit_reduction = to_money(value - cash_refund)

    ret = PurchaseReturn(
        document_number=_doc_number(db, PurchaseReturn, "PRET"),
        purchase_invoice_id=purchase_invoice_id, value=value, ledger_entry_id=None,
        actor_user_id=actor_user_id,
        branch_id=getattr(inv, "branch_id", None) or branch_for(db, actor_user_id=actor_user_id),
        return_date=return_date or date.today(), notes=notes,
        cost_center_id=getattr(inv, "cost_center_id", None),
    )
    db.add(ret)
    db.flush()
    for item_id, qty in lines:
        base_qty = to_qty(Decimal(qty) * purchased[item_id][2])
        out_kind, out_loc = received_into[item_id]
        stock_service.post_movement(
            db, item_id=item_id, location_kind=out_kind, location_id=out_loc,
            movement_type="purchase_return_out", direction=StockDirection.out, quantity=base_qty,
            actor_user_id=actor_user_id, source_doc_type=StockDoc.PURCHASE_RETURN, source_doc_id=ret.id,
        )
        ret.lines.append(PurchaseReturnLine(item_id=item_id, quantity=Decimal(qty)))

    cash_acc = account_resolver.resolve_cash_account(db, role=actor_role, user_id=actor_user_id,
                                                     branch_id=ret.branch_id)
    expense_acc = account_resolver.purchases_expense_account(db, branch_id=ret.branch_id)
    supplier_acc = supplier_service.require_account(db, inv.supplier_id)
    entry_lines = [LineInput(expense_acc.id, Direction.credit, value)]
    if cash_refund > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.debit, cash_refund))
    if credit_reduction > ZERO:
        entry_lines.append(LineInput(supplier_acc.account_id, Direction.debit, credit_reduction))
    entry = ledger_service.post_entry(
        db, entry_type="purchase_return", actor_user_id=actor_user_id, lines=entry_lines,
        branch_id=ret.branch_id,
        description=entry_text.purchase_return(ret.document_number),
        entry_date=ret.return_date,
        partner_kind=PartnerKind.supplier, partner_id=inv.supplier_id,
        cost_center_id=getattr(inv, "cost_center_id", None),
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="purchase.return", actor_user_id=actor_user_id,
                         entity_type="purchase_return", entity_id=ret.id,
                         after={"value": str(value)})
    return ret


def reverse_purchase_return(
    db: Session,
    *,
    return_id: int,
    actor_user_id: int,
) -> PurchaseReturn:
    ret = db.get(PurchaseReturn, return_id)
    if ret is None:
        raise PurchaseError("المردود غير موجود.")
    if ret.reversed_at is not None:
        raise PurchaseError("عُكس هذا المردود مسبقاً.")

    inv = db.get(PurchaseInvoice, ret.purchase_invoice_id) if ret.purchase_invoice_id else None
    if ret.purchase_invoice_id and inv is None:
        raise PurchaseError("فاتورة الشراء الخاصة بالمردود غير موجودة.")

    received_into = {
        ln.item_id: (ln.line_location_kind or inv.location_kind,
                     ln.line_location_id if ln.line_location_id is not None else inv.location_id)
        for ln in inv.lines
    } if inv else {}
    factors = {ln.item_id: to_factor(ln.unit_factor) for ln in inv.lines} if inv else {}
    fallback = ((inv.location_kind, inv.location_id) if inv
                else (ret.origin_location_kind, ret.origin_location_id))
    if fallback[0] is None or fallback[1] is None:
        raise PurchaseError("ليس لهذا المردود مخزن مسجّل — لا يمكن عكسه.")

    for line in ret.lines:
        back_kind, back_loc = received_into.get(line.item_id, fallback)
        base_qty = to_qty(Decimal(line.quantity) * factors.get(line.item_id, Decimal("1")))
        stock_service.post_movement(
            db, item_id=line.item_id, location_kind=back_kind, location_id=back_loc,
            movement_type="purchase_return_reversal", direction=StockDirection.in_,
            quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type="purchase_return_reversal", source_doc_id=ret.id,
        )

    if ret.ledger_entry_id:
        counter = ledger_service.reverse_entry(
            db, original_id=ret.ledger_entry_id, actor_user_id=actor_user_id)
        ret.reversal_entry_id = counter.id

    ret.reversed_at = datetime.utcnow()
    db.flush()
    audit_service.record(db, action="purchase.return.reverse", actor_user_id=actor_user_id,
                         entity_type="purchase_return", entity_id=ret.id,
                         after={"reversed": True})
    return ret


def create_standalone_purchase_return(
    db: Session,
    *,
    supplier_id: int,
    origin_location_kind: LocationKind,
    origin_location_id: int,
    lines: list[dict],
    actor_role: RoleName,
    actor_user_id: int,
    return_date: date | None = None,
    notes: str | None = None,
    expense_account_id: int | None = None,
    variable_discount_pct: Decimal = ZERO,
    external_document_number: str | None = None,
    statement1: str | None = None,
    statement2: str | None = None,
    statement3: str | None = None,
    replace_return_id: int | None = None,
    cost_center_id: int | None = None,
    cost_center_distribution: dict | None = None,
) -> PurchaseReturn:
    if not lines:
        raise PurchaseError("يجب أن يتضمن المردود صنفاً واحداً على الأقل.")
    variable = Decimal(variable_discount_pct or 0)
    if variable < ZERO or variable >= Decimal("100"):
        raise PurchaseError("يجب أن يكون خصم المستند من صفر إلى أقل من ١٠٠٪.")

    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise PurchaseError("المورد غير موجود.")

    gross = ZERO
    built: list[dict] = []
    for ln in lines:
        item = db.get(Item, ln["item_id"])
        if item is None:
            raise PurchaseError("الصنف غير موجود.")
        qty = Decimal(ln["quantity"])
        if qty <= ZERO:
            raise PurchaseError("يجب أن تكون الكمية أكبر من صفر.")
        unit = ln.get("unit")
        factor = uom_service.resolve_factor(db, item, unit) if unit else Decimal("1")
        price = to_money(ln.get("unit_price") or 0)
        disc = ln.get("discount_pct")
        disc = Decimal(disc) if disc is not None else None
        before = to_money(qty * price)
        line_total = to_money(before * (Decimal("1") - (disc or ZERO) / Decimal("100")))
        gross += line_total
        built.append({
            "item_id": item.id, "quantity": qty, "unit": unit, "factor": to_factor(factor),
            "unit_price": price, "discount_pct": disc, "line_total": line_total,
            "fixed_discount_pct": ln.get("fixed_discount_pct"),
            "variable_discount_pct": ln.get("variable_discount_pct"),
            "location_kind": ln.get("location_kind") or origin_location_kind,
            "location_id": ln.get("location_id") or origin_location_id,
        })

    gross = to_money(gross)
    fixed = sales_service.fixed_discount_pct(db)
    value = discounts.apply(gross, fixed, variable)

    existing = db.get(PurchaseReturn, replace_return_id) if replace_return_id else None
    if replace_return_id and existing is None:
        raise PurchaseError("المردود المراد تعديله غير موجود.")

    ret = existing or PurchaseReturn(
        document_number=_doc_number(db, PurchaseReturn, "PRET"),
        purchase_invoice_id=None,
        supplier_id=supplier_id,
        origin_location_kind=origin_location_kind,
        origin_location_id=origin_location_id,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind=origin_location_kind,
                             location_id=origin_location_id),
        gross=gross, variable_discount_pct=variable,
        combined_pct=discounts.combine(fixed, variable), value=value,
        ledger_entry_id=None, actor_user_id=actor_user_id,
        return_date=return_date or date.today(), notes=notes,
        cost_center_id=cost_center_id,
        expense_account_id=expense_account_id,
        external_document_number=external_document_number,
        statement1=statement1, statement2=statement2, statement3=statement3,
    )
    if existing is not None:
        existing.supplier_id = supplier_id
        existing.origin_location_kind = origin_location_kind
        existing.origin_location_id = origin_location_id
        existing.gross = gross
        existing.variable_discount_pct = variable
        existing.combined_pct = discounts.combine(fixed, variable)
        existing.value = value
        existing.ledger_entry_id = None
        existing.notes = notes
        existing.expense_account_id = expense_account_id
        existing.external_document_number = external_document_number
        existing.statement1 = statement1
        existing.statement2 = statement2
        existing.statement3 = statement3
        if return_date is not None:
            existing.return_date = return_date
        ret.lines.clear()
    else:
        db.add(ret)
    db.flush()

    for b in built:
        stock_service.post_movement(
            db, item_id=b["item_id"], location_kind=b["location_kind"],
            location_id=b["location_id"], movement_type="purchase_return_out",
            direction=StockDirection.out, quantity=to_qty(b["quantity"] * b["factor"]),
            actor_user_id=actor_user_id, source_doc_type=StockDoc.PURCHASE_RETURN,
            source_doc_id=ret.id,
        )
        ret.lines.append(PurchaseReturnLine(
            item_id=b["item_id"], quantity=b["quantity"], unit_price=b["unit_price"],
            discount_pct=b["discount_pct"], unit=b["unit"], unit_factor=b["factor"],
            fixed_discount_pct=b["fixed_discount_pct"],
            variable_discount_pct=b["variable_discount_pct"],
            line_location_kind=b["location_kind"], line_location_id=b["location_id"],
            line_total=b["line_total"]))

    expense_acc = (db.get(Account, expense_account_id) if expense_account_id
                   else account_resolver.purchases_expense_account(db, branch_id=ret.branch_id))
    if expense_acc is None:
        raise PurchaseError("حساب المشتريات غير موجود.")
    supplier_acc = supplier_service.require_account(db, supplier_id)

    entry = ledger_service.post_entry(
        db, entry_type="purchase_return", actor_user_id=actor_user_id,
        branch_id=ret.branch_id,
        lines=[
            LineInput(expense_acc.id, Direction.credit, value),
            LineInput(supplier_acc.account_id, Direction.debit, value),
        ],
        description=entry_text.purchase_return(ret.document_number),
        entry_date=ret.return_date,
        partner_kind=PartnerKind.supplier, partner_id=supplier_id,
        cost_center_id=cost_center_id,
        cost_center_distribution=cost_center_distribution,
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="purchase.return.standalone", actor_user_id=actor_user_id,
                         entity_type="purchase_return", entity_id=ret.id,
                         after={"value": str(value), "supplier_id": supplier_id})
    return ret
