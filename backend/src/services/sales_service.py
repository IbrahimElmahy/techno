"""Sales service (T035–T036). FR-017–021.

Sale: combined-% discount once on gross; split cash/credit to ONE balanced entry (debit cash-location
+ customer receivable; credit sales_revenue). Return: partial; money reversed proportionally to the
original invoice's cash/credit split (research R9).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core import hooks
from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item, ItemKind, PriceTier
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Direction
from src.models.role import RoleName
from src.models.sales import (
    SalesInvoice,
    SalesInvoiceLine,
    SalesReturn,
    SalesReturnLine,
    SalesSetting,
)
from src.models.stock import LocationKind, StockDirection
from src.services import (
    account_resolver,
    audit_service,
    batch_service,
    ledger_service,
    pricing_service,
    serial_service,
    stock_service,
    uom_service,
)
from src.services.batch_service import BatchError
from src.services.ledger_service import LineInput
from src.services.pricing_service import PricingError
from src.services.serial_service import SerialError
from src.services.uom_service import UomError


class SalesError(Exception):
    pass


class CreditLimitError(SalesError):
    """A credit sale would exceed the customer's credit limit (012). API maps to 409."""


class DueTermError(SalesError):
    """A credit sale's term exceeds the customer's maximum due-term (012). API maps to 409."""


@dataclass(frozen=True)
class SaleLine:
    item_id: int
    quantity: Decimal
    tier: PriceTier | None = None          # (007) explicit tier override per line
    unit_price: Decimal | None = None      # (007) manual price override (below-tier needs capability)
    unit: str | None = None                # (008) unit of measure; None = base unit
    serials: list[str] | None = None       # (009) serial numbers (required for serialized items)


def _doc_number(db: Session, model, prefix: str) -> str:
    n = db.scalar(select(func.count()).select_from(model)) or 0
    return f"{prefix}-{n + 1:06d}"


def fixed_discount_pct(db: Session) -> Decimal:
    s = db.scalar(select(SalesSetting))
    return Decimal(s.fixed_discount_pct) if s else Decimal("0")


def compute_net(gross: Decimal, combined_pct: Decimal) -> Decimal:
    return to_money(Decimal(gross) * (Decimal("1") - Decimal(combined_pct) / Decimal("100")))


def create_sale(
    db: Session,
    *,
    customer_id: int,
    origin_location_kind: LocationKind,
    origin_location_id: int,
    variable_discount_pct: Decimal,
    cash_amount: Decimal,
    credit_amount: Decimal,
    lines: list[SaleLine],
    actor_role: RoleName,
    actor_user_id: int,
    can_sell_below: bool = False,
    can_over_credit_limit: bool = False,
    due_term_days: int | None = None,
) -> SalesInvoice:
    if not lines:
        raise SalesError("A sale needs at least one line.")
    fixed = fixed_discount_pct(db)
    variable = Decimal(variable_discount_pct)
    combined = fixed + variable
    if combined >= Decimal("100") or variable < ZERO:
        raise SalesError("Combined discount must be < 100% and the variable discount non-negative.")

    customer = db.get(Customer, customer_id)

    gross = ZERO
    # (007) price resolves from a tier (override per line); below-tier needs sell.below_price.
    # (008) a unit may be chosen: the list price = base-tier price × factor; stock moves in base units
    # (= entered qty × factor). The line records tier + actual price + unit + factor.
    built: list[tuple[SaleLine, Decimal, Decimal, PriceTier, Decimal]] = []
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None or item.kind != ItemKind.product:
            raise SalesError("Sales accept products only.")
        try:
            factor = uom_service.resolve_factor(db, item, ln.unit)
        except UomError as exc:
            raise SalesError(str(exc)) from exc
        try:  # (009) validate serial count/base-unit/serialized consistency before any stock move
            serial_service.assert_sale_serials(
                item, quantity=ln.quantity, unit_factor=factor, serials=ln.serials
            )
        except SerialError as exc:
            raise SalesError(str(exc)) from exc
        try:  # (011) perishable items sell in the base unit (FEFO is base-unit)
            batch_service.assert_base_unit(item, factor)
        except BatchError as exc:
            raise SalesError(str(exc)) from exc
        tier = pricing_service.resolve_tier(ln.tier, customer)
        try:
            base_price = pricing_service.tier_price(db, item, tier)
        except PricingError as exc:
            raise SalesError(str(exc)) from exc
        list_price = to_money(base_price * factor)  # price for one of the chosen unit
        unit_price = to_money(ln.unit_price) if ln.unit_price is not None else list_price
        if unit_price < list_price and not can_sell_below:
            raise SalesError(
                f"Selling below the '{tier.value}' tier price ({list_price}) requires the "
                f"sell.below_price capability."
            )
        line_total = to_money(Decimal(ln.quantity) * unit_price)
        gross += line_total
        built.append((ln, unit_price, line_total, tier, factor))
    gross = to_money(gross)
    net = compute_net(gross, combined)
    if to_money(cash_amount) + to_money(credit_amount) != net:
        raise SalesError("cash + credit must equal the net total.")

    cust_acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer_id))
    if cust_acc is None:
        raise SalesError("Customer has no account.")

    # (012) Credit controls — enforced only on the credit portion; cash-only sales are never blocked.
    credit_portion = to_money(credit_amount)
    due_date: date | None = None
    if credit_portion > ZERO:
        # Amount ceiling: outstanding (derived) + this credit vs the limit; == is allowed, > blocks.
        if customer is not None and customer.credit_limit is not None and not can_over_credit_limit:
            outstanding = to_money(ledger_service.balance_of(db, cust_acc.account_id))
            if outstanding + credit_portion > to_money(customer.credit_limit):
                raise CreditLimitError(
                    f"Credit sale would exceed the customer's credit limit "
                    f"({to_money(customer.credit_limit)}); outstanding {outstanding}."
                )
        # Due-term cap (hard policy, no override) + due_date stamping.
        if due_term_days is not None:
            if due_term_days < 0:
                raise DueTermError("Due-term days must be non-negative.")
            if customer is not None and customer.max_due_term_days is not None \
                    and due_term_days > customer.max_due_term_days:
                raise DueTermError(
                    f"Credit term {due_term_days}d exceeds the customer's maximum "
                    f"({customer.max_due_term_days}d)."
                )
            due_date = date.today() + timedelta(days=due_term_days)

    cash_acc = account_resolver.resolve_cash_account(db, role=actor_role, user_id=actor_user_id)

    invoice = SalesInvoice(
        document_number=_doc_number(db, SalesInvoice, "SINV"),
        customer_id=customer_id, origin_location_kind=origin_location_kind,
        origin_location_id=origin_location_id, gross=gross, fixed_discount_pct=fixed,
        variable_discount_pct=variable, combined_pct=combined, net=net,
        cash_amount=to_money(cash_amount), credit_amount=credit_portion,
        cash_account_id=cash_acc.id, ledger_entry_id=0, actor_user_id=actor_user_id,
        due_date=due_date,
    )
    db.add(invoice)
    db.flush()
    for ln, unit_price, line_total, tier, factor in built:
        base_qty = to_qty(Decimal(ln.quantity) * factor)  # (008) stock moves in the base unit
        stock_service.post_movement(
            db, item_id=ln.item_id, location_kind=origin_location_kind,
            location_id=origin_location_id, movement_type="sale_out",
            direction=StockDirection.out, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type="sale", source_doc_id=invoice.id,
        )
        invoice.lines.append(
            SalesInvoiceLine(item_id=ln.item_id, quantity=ln.quantity,
                             unit_price=unit_price, line_total=line_total, price_tier=tier,
                             unit=ln.unit, unit_factor=factor)
        )
        if ln.serials:  # (009) mark the specific serials sold (validated above)
            item = db.get(Item, ln.item_id)
            try:
                serial_service.mark_sold(
                    db, item=item, origin_kind=origin_location_kind, origin_id=origin_location_id,
                    serials=ln.serials, invoice_id=invoice.id,
                )
            except SerialError as exc:
                raise SalesError(str(exc)) from exc
        item = db.get(Item, ln.item_id)
        if item.is_perishable:  # (011) deplete batches earliest-expiry-first
            try:
                batch_service.consume_fefo(
                    db, item=item, location_kind=origin_location_kind,
                    location_id=origin_location_id, quantity=base_qty,
                )
            except BatchError as exc:
                raise SalesError(str(exc)) from exc

    entry_lines = []
    if to_money(cash_amount) > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.debit, to_money(cash_amount)))
    if to_money(credit_amount) > ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.debit, to_money(credit_amount)))
    entry_lines.append(LineInput(account_resolver.sales_revenue_account(db).id, Direction.credit, net))
    entry = ledger_service.post_entry(
        db, entry_type="sale", actor_user_id=actor_user_id, lines=entry_lines,
        rep_id=actor_user_id if actor_role == RoleName.sales_rep else None,
        description=f"Sale {invoice.document_number}",
    )
    invoice.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="sale.create", actor_user_id=actor_user_id,
                         entity_type="sales_invoice", entity_id=invoice.id,
                         after={"net": str(net), "doc": invoice.document_number})
    # Additive cross-feature hook (no-op if no subscriber, e.g. 002-only deploy). 003 loyalty earns here.
    hooks.emit("sale_created", db, invoice)
    return invoice


def _already_returned(db: Session, invoice_id: int) -> dict[int, Decimal]:
    rows = db.execute(
        select(SalesReturnLine.item_id, func.coalesce(func.sum(SalesReturnLine.quantity), 0))
        .join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id)
        .where(SalesReturn.sales_invoice_id == invoice_id)
        .group_by(SalesReturnLine.item_id)
    ).all()
    return {item_id: Decimal(qty) for item_id, qty in rows}


def return_sale(
    db: Session,
    *,
    sales_invoice_id: int,
    lines: list[tuple[int, Decimal]],
    actor_user_id: int,
    serials: dict[int, list[str]] | None = None,  # (009) item_id → serials being returned
    expiries: dict[int, date] | None = None,       # (011) item_id → expiry for the restored batch
) -> SalesReturn:
    inv = db.get(SalesInvoice, sales_invoice_id)
    if inv is None:
        raise SalesError("Sales invoice not found.")
    # (008) carry the line's unit_factor so the return reverses stock in base units.
    sold = {
        ln.item_id: (Decimal(ln.quantity), to_money(ln.unit_price), to_qty(ln.unit_factor))
        for ln in inv.lines
    }
    prior = _already_returned(db, sales_invoice_id)

    value = ZERO
    for item_id, qty in lines:
        qty = Decimal(qty)
        if item_id not in sold:
            raise SalesError("Returned item was not on the invoice.")
        if prior.get(item_id, ZERO) + qty > sold[item_id][0]:
            raise SalesError("Cumulative return exceeds sold quantity.")
        value += to_money(qty * sold[item_id][1])
    value = to_money(value)

    # Proportional split from the ORIGINAL invoice's cash/credit composition.
    cash_refund = to_money(value * to_money(inv.cash_amount) / to_money(inv.net)) if inv.net else ZERO
    credit_reduction = to_money(value - cash_refund)

    ret = SalesReturn(
        document_number=_doc_number(db, SalesReturn, "SRET"),
        sales_invoice_id=sales_invoice_id, value=value, cash_refund=cash_refund,
        credit_reduction=credit_reduction, ledger_entry_id=0, actor_user_id=actor_user_id,
    )
    db.add(ret)
    db.flush()
    for item_id, qty in lines:
        base_qty = to_qty(Decimal(qty) * sold[item_id][2])  # (008) reverse stock in base units
        stock_service.post_movement(
            db, item_id=item_id, location_kind=inv.origin_location_kind,
            location_id=inv.origin_location_id, movement_type="sale_return_in",
            direction=StockDirection.in_, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type="sale_return", source_doc_id=ret.id,
        )
        ret.lines.append(SalesReturnLine(item_id=item_id, quantity=Decimal(qty)))
        item = db.get(Item, item_id)  # (009) restore serials for serialized items
        if item.is_serialized:
            ser = (serials or {}).get(item_id) or []
            if Decimal(len(ser)) != to_qty(Decimal(qty)):
                raise SalesError("Serial count must equal the returned quantity.")
            try:
                serial_service.restore_for_return(
                    db, item=item, invoice_id=inv.id, origin_kind=inv.origin_location_kind,
                    origin_id=inv.origin_location_id, serials=ser,
                )
            except SerialError as exc:
                raise SalesError(str(exc)) from exc
        if item.is_perishable:  # (011) restore returned quantity to a batch at the given expiry
            try:
                batch_service.restore_for_return(
                    db, item=item, location_kind=inv.origin_location_kind,
                    location_id=inv.origin_location_id,
                    expiry_date=(expiries or {}).get(item_id), quantity=base_qty,
                )
            except BatchError as exc:
                raise SalesError(str(exc)) from exc

    cust_acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == inv.customer_id))
    entry_lines = [LineInput(account_resolver.sales_revenue_account(db).id, Direction.debit, value)]
    if cash_refund > ZERO:
        entry_lines.append(LineInput(inv.cash_account_id, Direction.credit, cash_refund))
    if credit_reduction > ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.credit, credit_reduction))
    entry = ledger_service.post_entry(
        db, entry_type="sale_return", actor_user_id=actor_user_id, lines=entry_lines,
        description=f"Sales return {ret.document_number}",
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="sale.return", actor_user_id=actor_user_id,
                         entity_type="sales_return", entity_id=ret.id, after={"value": str(value)})
    hooks.emit("sale_returned", db, ret, inv)
    return ret
