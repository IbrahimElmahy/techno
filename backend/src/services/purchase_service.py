"""Purchase service (T022–T023). FR-010–012.

Purchase: raw materials in (stock) + one balanced ledger entry (debit purchases_expense; credit
cash-location + supplier_payable). Return: partial, money reversed proportionally to the original
cash/credit split (research R9).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.ledger import Direction
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.models.supplier import Supplier, SupplierAccount
from src.services import account_resolver, audit_service, ledger_service, stock_service, uom_service
from src.services.ledger_service import LineInput
from src.services.uom_service import UomError


class PurchaseError(Exception):
    pass


@dataclass(frozen=True)
class PurchaseLine:
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    unit: str | None = None    # (008) unit of measure; None = base unit
    # (030) receive this line into its own warehouse; None = the document's location
    warehouse_id: int | None = None


def _doc_number(db: Session, model, prefix: str) -> str:
    return numbering.next_document_number(db, model, prefix)


def create_purchase(
    db: Session,
    *,
    supplier_id: int,
    location_kind: LocationKind,
    location_id: int,
    cash_amount: Decimal,
    credit_amount: Decimal,
    lines: list[PurchaseLine],
    actor_role: RoleName,
    actor_user_id: int,
    # (030) document fields — all optional so pre-030 callers keep working unchanged.
    rep_id: int | None = None,
    expense_account_id: int | None = None,
    external_document_number: str | None = None,
    notes: str | None = None,
    statement1: str | None = None,
    statement2: str | None = None,
    statement3: str | None = None,
    purchase_date=None,
) -> PurchaseInvoice:
    if not lines:
        raise PurchaseError("فاتورة الشراء لازم يكون فيها صنف واحد على الأقل.")
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise PurchaseError("المورد مش موجود.")
    supplier_acc = db.scalar(
        select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id)
    )

    total = ZERO
    built: list[tuple[PurchaseLine, Decimal, Decimal]] = []
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None:
            raise PurchaseError("الصنف المشترى مش موجود.")
        # Purchases accept any stocked item — raw materials AND finished products (resale/trading).
        try:
            factor = uom_service.resolve_factor(db, item, ln.unit)  # (008)
        except UomError as exc:
            raise PurchaseError(str(exc)) from exc
        line_total = to_money(Decimal(ln.quantity) * Decimal(ln.unit_price))
        total += line_total
        built.append((ln, line_total, factor))
    total = to_money(total)
    if to_money(cash_amount) + to_money(credit_amount) != total:
        raise PurchaseError("النقدي + الآجل لازم يساوي إجمالي فاتورة الشراء.")

    # Stock in (raw materials) — one movement per line.
    invoice = PurchaseInvoice(
        document_number=_doc_number(db, PurchaseInvoice, "PINV"),
        supplier_id=supplier_id, location_kind=location_kind, location_id=location_id,
        total=total, cash_amount=to_money(cash_amount), credit_amount=to_money(credit_amount),
        ledger_entry_id=None, actor_user_id=actor_user_id,
        rep_id=rep_id, expense_account_id=expense_account_id,
        external_document_number=(external_document_number or None),
        notes=notes, statement1=statement1, statement2=statement2, statement3=statement3,
        # Defaulted here rather than in the column so a purchase always carries a real day — a
        # NULL would push every report that groups by day into guessing.
        purchase_date=purchase_date or date.today(),
    )
    db.add(invoice)
    db.flush()
    for ln, line_total, factor in built:
        base_qty = to_qty(Decimal(ln.quantity) * factor)  # (008) stock in base units
        # (030) Each line may be received into its own warehouse.
        line_kind, line_loc = ((LocationKind.warehouse, ln.warehouse_id)
                               if ln.warehouse_id is not None else (location_kind, location_id))
        stock_service.post_movement(
            db, item_id=ln.item_id, location_kind=line_kind, location_id=line_loc,
            movement_type="purchase_in", direction=StockDirection.in_, quantity=base_qty,
            actor_user_id=actor_user_id, source_doc_type="purchase", source_doc_id=invoice.id,
        )
        invoice.lines.append(
            PurchaseInvoiceLine(item_id=ln.item_id, quantity=ln.quantity,
                                unit_price=to_money(ln.unit_price), line_total=line_total,
                                unit=ln.unit, unit_factor=factor,
                                line_location_kind=line_kind, line_location_id=line_loc)
        )

    # Money: debit purchases_expense T; credit cash-location C + supplier_payable P.
    cash_acc = account_resolver.resolve_cash_account(db, role=actor_role, user_id=actor_user_id)
    expense_acc = account_resolver.purchases_expense_account(db)
    entry_lines = [LineInput(expense_acc.id, Direction.debit, total)]
    if to_money(cash_amount) > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.credit, to_money(cash_amount)))
    if to_money(credit_amount) > ZERO:
        if supplier_acc is None:
            raise PurchaseError("المورد ده مالوش حساب دائنين.")
        entry_lines.append(LineInput(supplier_acc.account_id, Direction.credit, to_money(credit_amount)))
    entry = ledger_service.post_entry(
        db, entry_type="purchase", actor_user_id=actor_user_id, lines=entry_lines,
        description=f"Purchase {invoice.document_number}",
    )
    invoice.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="purchase.create", actor_user_id=actor_user_id,
                         entity_type="purchase_invoice", entity_id=invoice.id,
                         after={"total": str(total), "doc": invoice.document_number})
    return invoice


def _already_returned(db: Session, invoice_id: int) -> dict[int, Decimal]:
    rows = db.execute(
        select(PurchaseReturnLine.item_id, func.coalesce(func.sum(PurchaseReturnLine.quantity), 0))
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .where(PurchaseReturn.purchase_invoice_id == invoice_id)
        .group_by(PurchaseReturnLine.item_id)
    ).all()
    return {item_id: Decimal(qty) for item_id, qty in rows}


def return_purchase(
    db: Session,
    *,
    purchase_invoice_id: int,
    lines: list[tuple[int, Decimal]],  # (item_id, quantity)
    actor_role: RoleName,
    actor_user_id: int,
    return_date: date | None = None,
    notes: str | None = None,
) -> PurchaseReturn:
    inv = db.get(PurchaseInvoice, purchase_invoice_id)
    if inv is None:
        raise PurchaseError("فاتورة الشراء مش موجودة.")
    purchased = {
        ln.item_id: (Decimal(ln.quantity), to_money(ln.unit_price), to_qty(ln.unit_factor))
        for ln in inv.lines
    }
    # (030) Each received line remembers its warehouse, so the return takes the goods back out of
    # exactly that one. Lines written before 030 fall back to the invoice's own location.
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
            raise PurchaseError("الصنف ده مش على فاتورة الشراء دي أصلاً.")
        if prior.get(item_id, ZERO) + qty > purchased[item_id][0]:
            raise PurchaseError(
                f"مرتجعات الفاتورة دي وصلت للكمية المشتراة خلاص — "
                f"اتشرى {purchased[item_id][0]} واترجّع {prior.get(item_id, ZERO)} قبل كده.")
        value += to_money(qty * purchased[item_id][1])
    value = to_money(value)

    # Proportional split from the original purchase's cash/credit composition.
    cash_refund = to_money(value * to_money(inv.cash_amount) / to_money(inv.total)) if inv.total else ZERO
    credit_reduction = to_money(value - cash_refund)

    ret = PurchaseReturn(
        document_number=_doc_number(db, PurchaseReturn, "PRET"),
        purchase_invoice_id=purchase_invoice_id, value=value, ledger_entry_id=None,
        actor_user_id=actor_user_id,
        # Defaulted here rather than on the column: returns recorded before this existed have no
        # captured day, and a column default would have invented one for them.
        return_date=return_date or date.today(), notes=notes,
    )
    db.add(ret)
    db.flush()
    for item_id, qty in lines:
        base_qty = to_qty(Decimal(qty) * purchased[item_id][2])  # (008) reverse stock in base units
        out_kind, out_loc = received_into[item_id]   # (030) out of the warehouse it came into
        stock_service.post_movement(
            db, item_id=item_id, location_kind=out_kind, location_id=out_loc,
            movement_type="purchase_return_out", direction=StockDirection.out, quantity=base_qty,
            actor_user_id=actor_user_id, source_doc_type="purchase_return", source_doc_id=ret.id,
        )
        ret.lines.append(PurchaseReturnLine(item_id=item_id, quantity=Decimal(qty)))

    # Reverse money proportionally: credit purchases_expense V; debit cash Cr + supplier_payable Pr.
    cash_acc = account_resolver.resolve_cash_account(db, role=actor_role, user_id=actor_user_id)
    expense_acc = account_resolver.purchases_expense_account(db)
    supplier_acc = db.scalar(
        select(SupplierAccount).where(SupplierAccount.supplier_id == inv.supplier_id)
    )
    entry_lines = [LineInput(expense_acc.id, Direction.credit, value)]
    if cash_refund > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.debit, cash_refund))
    if credit_reduction > ZERO:
        entry_lines.append(LineInput(supplier_acc.account_id, Direction.debit, credit_reduction))
    entry = ledger_service.post_entry(
        db, entry_type="purchase_return", actor_user_id=actor_user_id, lines=entry_lines,
        description=f"Purchase return {ret.document_number}",
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="purchase.return", actor_user_id=actor_user_id,
                         entity_type="purchase_return", entity_id=ret.id,
                         after={"value": str(value)})
    return ret
