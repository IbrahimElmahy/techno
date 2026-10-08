from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core import hooks
from src.lib import discounts
from src.core.money import ZERO, to_factor, to_money, to_qty
from src.lib import entry_text
from src.lib import discounts
from src.models.catalog import Item, ItemKind, PriceTier
from src.models.customer import Customer, CustomerAccount
from src.services import customer_service
from src.services.customer_merge_service import MergeError
from src.models.ledger import Account, Direction, PartnerKind
from src.models.role import RoleName
from src.models.sales import (
    SalesInvoice,
    SalesInvoiceLine,
    SalesReturn,
    SalesReturnLine,
    SalesSetting,
)
from src.models.sales_expense import ExpenseKind, SalesInvoiceExpense
from src.models.stock import LocationKind, StockDirection, StockDoc
from src.services import (
    reservation_service,
    account_resolver,
    audit_service,
    batch_service,
    costing_service,
    ledger_service,
    pricing_service,
    serial_service,
    stock_service,
    tax_service,
    uom_service,
)
from src.services.ledger_service import LineInput
from src.services.pricing_service import PricingError
from src.services.serial_service import SerialError
from src.services.uom_service import UomError
from src.auth.branch_scope import branch_for


class SalesError(Exception):
    pass


@dataclass(frozen=True)
class SaleLine:
    item_id: int
    quantity: Decimal
    tier: PriceTier | None = None
    unit_price: Decimal | None = None
    unit: str | None = None
    serials: list[str] | None = None
    discount_pct: Decimal | None = None
    fixed_discount_pct: Decimal | None = None
    variable_discount_pct: Decimal | None = None
    warehouse_id: int | None = None


def _revenue_account_id(db: Session, chosen: int | None, branch_id: int | None = None) -> int:
    if chosen is None:
        return account_resolver.sales_revenue_account(db, branch_id=branch_id).id
    from src.models.ledger import Account

    acc = db.get(Account, chosen)
    if acc is None or not acc.active:
        raise SalesError("حساب الإيراد مش موجود.")
    if not acc.is_postable:
        raise SalesError("حساب الإيراد ده مجموعة مش حساب — اختار حساب بيقبل الترحيل.")
    return acc.id


def _line_location(ln: SaleLine, doc_kind: LocationKind, doc_id: int) -> tuple[LocationKind, int]:
    if ln.warehouse_id is not None:
        return LocationKind.warehouse, ln.warehouse_id
    return doc_kind, doc_id


def _split_expenses(db, expenses: list[dict] | None) -> tuple[Decimal, Decimal]:
    billed = operating = ZERO
    for exp in (expenses or []):
        amount = to_money(exp.get("amount") or 0)
        if amount <= ZERO:
            raise SalesError("قيمة المصروف لازم تكون أكبر من صفر.")
        account = db.get(Account, int(exp["account_id"]))
        if account is None:
            raise SalesError("حساب المصروف غير موجود.")
        if not account.is_postable:
            raise SalesError("حساب المصروف لازم يكون حساب ترحيل مش مجموعة.")
        kind = str(exp.get("kind", "billed"))
        if kind not in ("billed", "operating"):
            raise SalesError("نوع المصروف غير صحيح.")
        if kind == "operating":
            operating = to_money(operating + amount)
        else:
            billed = to_money(billed + amount)
    return billed, operating


def _coupon_count(serial_from: str | None, serial_to: str | None,
                  given: int | None) -> int | None:
    if given is not None:
        return int(given)
    if not serial_from or not serial_to:
        return None
    try:
        first, last = int(str(serial_from).strip()), int(str(serial_to).strip())
    except ValueError:
        return None
    return last - first + 1 if last >= first else None


def _assert_lines_available(
    db: Session, built_locations: list[tuple[int, LocationKind, int, Decimal]],
    customer_id: int | None = None,
) -> None:
    wanted: dict[tuple[int, LocationKind, int], Decimal] = {}
    for item_id, kind, loc_id, base_qty in built_locations:
        key = (item_id, kind, loc_id)
        wanted[key] = wanted.get(key, ZERO) + base_qty
    for (item_id, kind, loc_id), needed in wanted.items():
        on_hand = stock_service.on_hand(db, item_id, kind, loc_id)
        held = reservation_service.held_against(
            db, item_id=item_id, location_kind=kind, location_id=loc_id,
            except_customer_id=customer_id,
        )
        available = to_qty(Decimal(str(on_hand)) - Decimal(str(held)))
        if needed > available:
            if held > ZERO:
                raise stock_service.StockError(
                    f"المتاح {available} أقل من المطلوب {needed} — فيه {held} محجوزة لعميل تاني "
                    f"(صنف {item_id}، {kind.value} {loc_id})."
                )
            raise stock_service.StockError(
                stock_service.not_enough_message(db, item_id, kind, loc_id, available, needed)
            )


def _doc_number(db: Session, model, prefix: str) -> str:
    return numbering.next_document_number(db, model, prefix)


def fixed_discount_pct(db: Session) -> Decimal:
    s = db.scalar(select(SalesSetting))
    return Decimal(s.fixed_discount_pct) if s else Decimal("0")


def compute_net(gross: Decimal, combined_pct: Decimal) -> Decimal:
    return discounts.net_of(gross, combined_pct)


def _assert_bonus_target(db: Session, target_id: int | None, customer_id: int,
                         self_id: int | None) -> None:
    if self_id and target_id == self_id:
        raise SalesError("فاتورة البونص ماينفعش تبقى على نفسها.")
    target = db.get(SalesInvoice, target_id)
    if target is None:
        raise SalesError("فاتورة البيع اللي البونص عليها مش موجودة.")
    if target.is_bonus:
        raise SalesError("البونص لازم يبقى على فاتورة بيع، مش على بونص تاني.")
    if target.customer_id != customer_id:
        raise SalesError("فاتورة البونص لازم تبقى لنفس عميل الفاتورة اللي عليها.")


def _assert_not_below_cost(db: Session, built, base_costs: dict[int, Decimal], *,
                           allowed: bool) -> None:
    if allowed:
        return
    bad: list[str] = []
    for ln, unit_price, _total, _tier, factor, line_disc in built:
        base_cost = base_costs.get(ln.item_id) or ZERO
        if base_cost <= ZERO:
            continue
        unit_cost = to_money(Decimal(str(base_cost)) * factor)
        net_unit = discounts.net_of(unit_price, line_disc)
        if net_unit < unit_cost:
            item = db.get(Item, ln.item_id)
            name = item.name if item else str(ln.item_id)
            if name not in bad:
                bad.append(name)
    if not bad:
        return
    if len(bad) == 1:
        raise SalesError(f"سعر بيع «{bad[0]}» أقل من سعر الشراء — محتاج صلاحية "
                         f"«البيع تحت سعر التكلفة».")
    names = "، ".join(f"«{n}»" for n in bad)
    raise SalesError(f"سعر البيع أقل من سعر الشراء في الأصناف دي: {names} — محتاج صلاحية "
                     f"«البيع تحت سعر التكلفة».")


def create_sale(
    db: Session,
    *,
    customer_id: int,
    origin_location_kind: LocationKind,
    origin_location_id: int,
    variable_discount_pct: Decimal,
    cash_amount: Decimal,
    credit_amount: Decimal | None = None,
    lines: list[SaleLine],
    actor_role: RoleName,
    actor_user_id: int,
    family: str | None = None,
    cash_account_id: int | None = None,
    can_sell_below: bool = False,
    can_sell_below_cost: bool = False,
    keep_costs: dict[int, Decimal] | None = None,
    rep_id: int | None = None,
    revenue_account_id: int | None = None,
    external_document_number: str | None = None,
    notes: str | None = None,
    statement1: str | None = None,
    statement2: str | None = None,
    statement3: str | None = None,
    coupon_serial_from: str | None = None,
    coupon_serial_to: str | None = None,
    has_coupon_rows: bool = False,
    coupon_count: int | None = None,
    invoice_date=None,
    expenses: list[dict] | None = None,
    client_uuid: str | None = None,
    replace_invoice_id: int | None = None,
    cost_center_id: int | None = None,
    cost_center_distribution: dict | None = None,
    is_bonus: bool = False,
    bonus_for_invoice_id: int | None = None,
) -> SalesInvoice:
    if is_bonus:
        if bonus_for_invoice_id is not None:
            _assert_bonus_target(db, bonus_for_invoice_id, customer_id, replace_invoice_id)
        if to_money(cash_amount or ZERO) != ZERO:
            raise SalesError("فاتورة البونص مافيهاش فلوس — النقدي لازم يبقى صفر.")
        if expenses:
            raise SalesError("فاتورة البونص مافيهاش مصروفات.")
        variable_discount_pct = ZERO
        credit_amount = None
    has_coupons = bool(coupon_serial_from or coupon_serial_to or coupon_count
                       or has_coupon_rows)
    if not lines and not has_coupons:
        raise SalesError("الفاتورة لازم يكون فيها صنف أو دفتر كوبونات على الأقل.")
    fixed = ZERO if is_bonus else fixed_discount_pct(db)
    variable = Decimal(variable_discount_pct)
    combined = Decimal("100") if is_bonus else discounts.combine(fixed, variable)
    if variable < ZERO or variable >= Decimal("100") or fixed < ZERO or fixed >= Decimal("100"):
        raise SalesError("كل خصم لازم يكون من صفر لأقل من ١٠٠٪.")

    customer = db.get(Customer, customer_id)

    gross = ZERO
    built: list[tuple[SaleLine, Decimal, Decimal, PriceTier, Decimal, Decimal]] = []
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None or item.kind != ItemKind.product:
            raise SalesError("البيع بيقبل منتجات بس — مش خامات.")
        try:
            factor = uom_service.resolve_factor(db, item, ln.unit)
        except UomError as exc:
            raise SalesError(str(exc)) from exc
        if item.is_perishable and factor != Decimal("1"):
            raise SalesError("الأصناف اللي ليها صلاحية بتتباع بوحدتها الأساسية.")
        try:
            serial_service.assert_sale_serials(
                item, quantity=ln.quantity, unit_factor=factor, serials=ln.serials
            )
        except SerialError as exc:
            raise SalesError(str(exc)) from exc
        tier = pricing_service.resolve_tier(ln.tier, customer)
        try:
            base_price = pricing_service.tier_price(db, item, tier)
        except PricingError as exc:
            if ln.unit_price is not None and to_money(ln.unit_price) > 0 and not is_bonus:
                base_price = to_money(ln.unit_price) / factor
            else:
                raise SalesError(f"«{item.name}»: {exc}") from exc
        list_price = to_money(base_price * factor)
        unit_price = to_money(ln.unit_price) if ln.unit_price is not None else list_price
        if is_bonus:
            unit_price = list_price
        if unit_price < list_price and not can_sell_below:
            raise SalesError(
                f"البيع بأقل من سعر الشريحة ({list_price}) محتاج صلاحية "
                f"«البيع تحت السعر» — مالكش الصلاحية دي."
            )
        split = ln.fixed_discount_pct is not None or ln.variable_discount_pct is not None
        if split and not is_bonus:
            for half, label in ((ln.fixed_discount_pct, "الثابت"),
                                (ln.variable_discount_pct, "المتغيّر")):
                if half is None:
                    continue
                if Decimal(half) < ZERO or Decimal(half) >= Decimal("100"):
                    raise SalesError(
                        f"الخصم {label} لازم يكون من صفر لأقل من ١٠٠٪ — جالي {half}.")
            line_disc = discounts.combine(ln.fixed_discount_pct or ZERO,
                                          ln.variable_discount_pct or ZERO)
        else:
            line_disc = (Decimal(ln.discount_pct) if ln.discount_pct is not None
                         else Decimal(customer.discount_pct) if customer.discount_pct is not None
                         else Decimal(item.default_discount_pct or 0))
        if is_bonus:
            line_disc = Decimal("100")
        elif line_disc < ZERO or line_disc >= Decimal("100"):
            raise SalesError("خصم السطر لازم يكون من صفر لأقل من ١٠٠٪.")
        line_before = Decimal(ln.quantity) * unit_price
        line_total = ZERO if is_bonus else discounts.net_of(line_before, line_disc)
        gross += line_total
        built.append((ln, unit_price, line_total, tier, factor, line_disc))
    gross = to_money(gross)

    base_costs: dict[int, Decimal] = {}
    fresh_ids = [ln.item_id for ln, *_ in built
                 if (keep_costs or {}).get(ln.item_id) is None]
    base_costs.update(costing_service.average_cost_bulk(db, fresh_ids) if fresh_ids else {})
    for ln, *_ in built:
        kept = (keep_costs or {}).get(ln.item_id)
        if kept is not None:
            base_costs[ln.item_id] = Decimal(str(kept))
    _assert_not_below_cost(db, built, base_costs,
                           allowed=can_sell_below_cost or is_bonus)

    net = discounts.apply(gross, fixed, variable)
    tax = tax_service.tax_on(net, tax_service.vat_rate(db))
    billed_expenses, operating_expenses = _split_expenses(db, expenses)
    payable = to_money(net + tax + billed_expenses)

    cash = to_money(cash_amount)
    if credit_amount is None:
        credit_amount = payable - cash
    elif to_money(cash) + to_money(credit_amount) != payable:
        raise SalesError(
            f"النقدي + الآجل لازم يساوي المستحق ({payable})."
        )

    try:
        cust_acc = customer_service.require_account(db, customer_id, family=family)
    except (MergeError, customer_service.CustomerError) as exc:
        raise SalesError(str(exc)) from exc
    cash_acc = account_resolver.explicit_treasury(db, cash_account_id) or account_resolver.resolve_cash_account(
        db, role=actor_role, user_id=actor_user_id, family=family,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind=origin_location_kind,
                             location_id=origin_location_id))

    existing = db.get(SalesInvoice, replace_invoice_id) if replace_invoice_id else None
    if replace_invoice_id and existing is None:
        raise SalesError("الفاتورة اللي بتتعدّل مش موجودة.")

    _accounts = db.scalars(
        select(CustomerAccount).where(CustomerAccount.customer_id == customer_id)).all()
    _mine = [a for a in _accounts if family and a.family == family]
    _others = [a for a in _accounts if family and a.family and a.family != family]
    prior_balance = ledger_service.total_balance_of(
        db, [a.account_id for a in (_mine or _accounts)])
    other_family_balance = (ledger_service.total_balance_of(
        db, [a.account_id for a in _others]) if _others else None)
    other_family = (_others[0].family if len({a.family for a in _others}) == 1
                    else None) if _others else None
    invoice = existing or SalesInvoice(
        prior_balance=prior_balance,
        other_family_balance=other_family_balance, other_family=other_family,
        document_number=_doc_number(db, SalesInvoice, "BNS" if is_bonus else "SINV"),
        is_bonus=bool(is_bonus) or None,
        bonus_for_invoice_id=bonus_for_invoice_id if is_bonus else None,
        customer_id=customer_id, origin_location_kind=origin_location_kind,
        origin_location_id=origin_location_id, gross=gross, fixed_discount_pct=fixed,
        family=family,
        variable_discount_pct=variable, combined_pct=combined, net=net, tax_amount=tax,
        cash_amount=to_money(cash_amount), credit_amount=to_money(credit_amount),
        cash_account_id=cash_acc.id, ledger_entry_id=None, actor_user_id=actor_user_id,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind=origin_location_kind,
                             location_id=origin_location_id),
        rep_id=rep_id if rep_id is not None else (
            actor_user_id if actor_role == RoleName.sales_rep else None),
        revenue_account_id=revenue_account_id,
        external_document_number=(external_document_number or None),
        notes=notes, statement1=statement1, statement2=statement2, statement3=statement3,
        coupon_serial_from=(coupon_serial_from or None),
        coupon_serial_to=(coupon_serial_to or None),
        coupon_count=_coupon_count(coupon_serial_from, coupon_serial_to, coupon_count),
        invoice_date=invoice_date,
        client_uuid=client_uuid,
        cost_center_id=cost_center_id,
    )
    if existing is not None:
        existing.customer_id = customer_id
        existing.origin_location_kind = origin_location_kind
        existing.origin_location_id = origin_location_id
        existing.gross = gross
        existing.fixed_discount_pct = fixed
        existing.family = family
        existing.variable_discount_pct = variable
        existing.combined_pct = combined
        existing.net = net
        existing.tax_amount = tax
        existing.cash_amount = to_money(cash_amount)
        existing.credit_amount = to_money(credit_amount)
        existing.cash_account_id = cash_acc.id
        existing.ledger_entry_id = None
        existing.rep_id = rep_id if rep_id is not None else (
            actor_user_id if actor_role == RoleName.sales_rep else None)
        existing.revenue_account_id = revenue_account_id
        existing.external_document_number = (external_document_number or None)
        existing.notes = notes
        existing.statement1 = statement1
        existing.statement2 = statement2
        existing.statement3 = statement3
        existing.coupon_serial_from = (coupon_serial_from or None)
        existing.coupon_serial_to = (coupon_serial_to or None)
        existing.coupon_count = _coupon_count(coupon_serial_from, coupon_serial_to, coupon_count)
        existing.cost_center_id = cost_center_id
        existing.is_bonus = bool(is_bonus) or None
        existing.bonus_for_invoice_id = bonus_for_invoice_id if is_bonus else None
        if invoice_date is not None:
            existing.invoice_date = invoice_date
        invoice.lines.clear()
    else:
        db.add(invoice)
    db.flush()
    _assert_lines_available(db, [
        (ln.item_id, *_line_location(ln, origin_location_kind, origin_location_id),
         to_qty(Decimal(ln.quantity) * factor))
        for ln, _price, _total, _tier, factor, _disc in built
    ], customer_id=customer_id)
    for ln, unit_price, line_total, tier, factor, line_disc in built:
        base_qty = to_qty(Decimal(ln.quantity) * factor)
        line_kind, line_loc = _line_location(ln, origin_location_kind, origin_location_id)
        stock_service.post_movement(
            db, item_id=ln.item_id, location_kind=line_kind,
            location_id=line_loc, movement_type="sale_out",
            direction=StockDirection.out, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type=StockDoc.SALE, source_doc_id=invoice.id,
        )
        base_cost = base_costs.get(ln.item_id, ZERO)
        unit_cost = to_money(Decimal(str(base_cost)) * factor)
        invoice.lines.append(
            SalesInvoiceLine(item_id=ln.item_id, quantity=ln.quantity,
                             unit_price=unit_price, discount_pct=line_disc,
                             fixed_discount_pct=ln.fixed_discount_pct,
                             variable_discount_pct=(ZERO if is_bonus
                                                    else ln.variable_discount_pct),
                             line_total=line_total, price_tier=tier,
                             unit=ln.unit, unit_factor=factor,
                             location_kind=line_kind, location_id=line_loc,
                             unit_cost=unit_cost)
        )
        if ln.serials:
            item = db.get(Item, ln.item_id)
            try:
                serial_service.mark_sold(
                    db, item=item, origin_kind=line_kind, origin_id=line_loc,
                    serials=ln.serials, invoice_id=invoice.id,
                    actor_user_id=actor_user_id,
                )
            except SerialError as exc:
                raise SalesError(str(exc)) from exc
        line_item = db.get(Item, ln.item_id)
        if line_item.is_perishable:
            try:
                batch_service.consume_fefo(
                    db, item_id=ln.item_id, location_kind=line_kind,
                    location_id=line_loc, quantity=base_qty,
                    document_type=StockDoc.SALE, document_id=invoice.id,
                    actor_user_id=actor_user_id,
                )
            except batch_service.BatchError as exc:
                raise SalesError(str(exc)) from exc

    entry_lines = []
    if to_money(cash_amount) > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.debit, to_money(cash_amount)))
    credit = to_money(credit_amount)
    if credit > ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.debit, credit))
    elif credit < ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.credit, -credit))
    if net > ZERO:
        entry_lines.append(LineInput(_revenue_account_id(db, revenue_account_id,
                                                         invoice.branch_id),
                                     Direction.credit, net))
    if tax > ZERO:
        entry_lines.append(LineInput(tax_service.output_tax_account(db).id,
                                     Direction.credit, tax, statement="ضريبة القيمة المضافة"))
    for exp in (expenses or []):
        amount = to_money(exp.get("amount") or 0)
        if amount <= ZERO:
            continue
        account_id = int(exp["account_id"])
        if str(exp.get("kind", "billed")) == "operating":
            entry_lines.append(LineInput(account_id, Direction.debit, amount,
                                         statement=exp.get("description") or "مصروف تشغيل"))
            entry_lines.append(LineInput(cash_acc.id, Direction.credit, amount,
                                         statement=exp.get("description") or "مصروف تشغيل"))
        else:
            entry_lines.append(LineInput(account_id, Direction.credit, amount,
                                         statement=exp.get("description") or "مصروف على العميل"))
    if entry_lines:
        entry = ledger_service.post_entry(
            db, entry_type="sale", actor_user_id=actor_user_id, lines=entry_lines,
            rep_id=invoice.rep_id, branch_id=invoice.branch_id,
            description=entry_text.sale(invoice.document_number),
            entry_date=invoice_date,
            partner_kind=PartnerKind.customer, partner_id=invoice.customer_id,
            cost_center_id=invoice.cost_center_id,
            cost_center_distribution=cost_center_distribution,
        )
        invoice.ledger_entry_id = entry.id
    else:
        invoice.ledger_entry_id = None
    for exp in (expenses or []):
        amount = to_money(exp.get("amount") or 0)
        if amount <= ZERO:
            continue
        db.add(SalesInvoiceExpense(
            invoice_id=invoice.id, account_id=int(exp["account_id"]),
            kind=ExpenseKind(str(exp.get("kind", "billed"))), amount=amount,
            description=exp.get("description"),
        ))
    invoice.expenses_billed = billed_expenses
    invoice.expenses_operating = operating_expenses
    db.flush()
    audit_service.record(db,
                         action="sale.edit" if replace_invoice_id else "sale.create",
                         actor_user_id=actor_user_id,
                         entity_type="sales_invoice", entity_id=invoice.id,
                         after={"net": str(net), "doc": invoice.document_number})
    hooks.emit("sale_created", db, invoice)
    return invoice


def _already_returned(db: Session, invoice_id: int) -> dict[int, Decimal]:
    rows = db.execute(
        select(SalesReturnLine.item_id, func.coalesce(func.sum(SalesReturnLine.quantity), 0))
        .join(SalesReturn, SalesReturn.id == SalesReturnLine.return_id)
        .where(SalesReturn.sales_invoice_id == invoice_id,
               SalesReturn.reversed_at.is_(None))
        .group_by(SalesReturnLine.item_id)
    ).all()
    return {item_id: Decimal(qty) for item_id, qty in rows}


def reverse_sales_return(
    db: Session,
    *,
    return_id: int,
    actor_user_id: int,
) -> SalesReturn:
    ret = db.get(SalesReturn, return_id)
    if ret is None:
        raise SalesError("المرتجع مش موجود.")
    if ret.reversed_at is not None:
        raise SalesError("المرتجع ده اتعكس قبل كده.")

    inv = db.get(SalesInvoice, ret.sales_invoice_id) if ret.sales_invoice_id else None
    if ret.sales_invoice_id and inv is None:
        raise SalesError("فاتورة البيع بتاعت المرتجع مش موجودة.")

    factors = {ln.item_id: to_factor(ln.unit_factor) for ln in inv.lines} if inv else {}

    for line in ret.lines:
        out_kind = line.location_kind
        out_loc = line.location_id
        if out_kind is None or out_loc is None:
            out_kind, out_loc = ret.origin_location_kind, ret.origin_location_id
        if out_kind is None or out_loc is None:
            raise SalesError("المرتجع ده مالوش مخزن مسجّل — مايتعكسش.")
        factor = (to_factor(line.unit_factor) if getattr(line, "unit_factor", None) is not None
                  else factors.get(line.item_id, Decimal("1")))
        base_qty = to_qty(Decimal(line.quantity) * factor)
        stock_service.post_movement(
            db, item_id=line.item_id, location_kind=out_kind, location_id=out_loc,
            movement_type="sale_return_reversal", direction=StockDirection.out,
            quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type="sale_return_reversal", source_doc_id=ret.id,
        )

    if ret.ledger_entry_id:
        counter = ledger_service.reverse_entry(
            db, original_id=ret.ledger_entry_id, actor_user_id=actor_user_id)
        ret.reversal_entry_id = counter.id

    ret.reversed_at = datetime.utcnow()
    db.flush()
    audit_service.record(db, action="sale.return.reverse", actor_user_id=actor_user_id,
                         entity_type="sales_return", entity_id=ret.id,
                         after={"reversed": True})
    return ret


def sold_lots(db: Session, invoice_id: int, item_id: int) -> dict:
    from src.models.catalog import BatchMovementKind, StockBatchMovement

    rows = db.scalars(
        select(StockBatchMovement).where(
            StockBatchMovement.document_type == "sales_invoice",
            StockBatchMovement.document_id == invoice_id,
            StockBatchMovement.item_id == item_id,
        )
    ).all()
    taken: dict = {}
    for r in rows:
        q = to_qty(r.quantity)
        if r.kind == BatchMovementKind.consumed:
            taken[r.expiry_date] = to_qty(taken.get(r.expiry_date, ZERO) + q)
        elif r.kind == BatchMovementKind.returned:
            taken[r.expiry_date] = to_qty(taken.get(r.expiry_date, ZERO) - q)
    return {k: v for k, v in taken.items() if v > ZERO}


def sold_serials(db: Session, invoice_id: int, item_id: int) -> list[str]:
    from src.models.catalog import ItemSerial, SerialStatus

    return [
        r.serial for r in db.scalars(
            select(ItemSerial).where(
                ItemSerial.item_id == item_id,
                ItemSerial.sold_invoice_id == invoice_id,
                ItemSerial.status == SerialStatus.sold,
            )
        ).all()
    ]


def reverse_sale(db: Session, *, sales_invoice_id: int, actor_user_id: int) -> SalesReturn:
    inv = db.get(SalesInvoice, sales_invoice_id)
    if inv is None:
        raise SalesError("فاتورة البيع مش موجودة.")

    prior = _already_returned(db, sales_invoice_id)
    lines: list[tuple[int, Decimal]] = []
    expiry_dates: dict = {}
    serials: dict[int, list[str]] = {}

    for ln in inv.lines:
        remaining = to_qty(Decimal(ln.quantity) - prior.get(ln.item_id, ZERO))
        if remaining <= ZERO:
            continue
        lines.append((ln.item_id, remaining))
        item = db.get(Item, ln.item_id)
        if item is not None and item.is_perishable:
            lots = sold_lots(db, sales_invoice_id, ln.item_id)
            if lots:
                expiry_dates[ln.item_id] = min(lots.keys())
        if item is not None and item.is_serialized:
            serials[ln.item_id] = sold_serials(db, sales_invoice_id, ln.item_id)

    if not lines:
        raise SalesError("الفاتورة دي اترجّعت بالكامل قبل كده — مفيش حاجة تتعكس.")

    return return_sale(
        db, sales_invoice_id=sales_invoice_id, lines=lines, actor_user_id=actor_user_id,
        serials=serials or None, expiry_dates=expiry_dates or None,
    )


def return_sale(
    db: Session,
    *,
    sales_invoice_id: int,
    lines: list[tuple[int, Decimal]],
    actor_user_id: int,
    serials: dict[int, list[str]] | None = None,
    expiry_dates: dict[int, object] | None = None,
) -> SalesReturn:
    inv = db.get(SalesInvoice, sales_invoice_id)
    if inv is None:
        raise SalesError("فاتورة البيع مش موجودة.")
    doc_pct = Decimal(getattr(inv, "combined_pct", 0) or 0)
    by_item: dict[int, list] = {}
    for ln in inv.lines:
        by_item.setdefault(ln.item_id, []).append(ln)
    prior = _already_returned(db, sales_invoice_id)

    wanted: dict[int, Decimal] = {}
    for item_id, qty in lines:
        wanted[item_id] = wanted.get(item_id, ZERO) + Decimal(qty)

    parts: list[tuple[object, Decimal]] = []
    value = ZERO
    for item_id, qty in wanted.items():
        rows = by_item.get(item_id)
        if not rows:
            raise SalesError("الصنف ده مش على الفاتورة دي أصلاً.")
        sold_qty = sum((Decimal(r.quantity) for r in rows), ZERO)
        before = prior.get(item_id, ZERO)
        if before + qty > sold_qty:
            raise SalesError(
                f"مرتجعات الفاتورة دي وصلت للكمية المباعة خلاص — "
                f"اتباع {sold_qty} واترجّع {before} قبل كده.")
        skip, left = before, qty
        for r in rows:
            room = Decimal(r.quantity)
            used = min(room, skip)
            skip -= used
            take = min(room - used, left)
            if take > ZERO:
                parts.append((r, take))
                value += discounts.apply(take * to_money(r.unit_price), Decimal(r.discount_pct or 0))
                left -= take
            if left <= ZERO:
                break
    value = discounts.apply(value, doc_pct)

    invoice_tax = to_money(getattr(inv, "tax_amount", ZERO) or ZERO)
    tax_refund = to_money(value * invoice_tax / to_money(inv.net)) if inv.net and invoice_tax else ZERO
    refund_total = to_money(value + tax_refund)

    payable = to_money(to_money(inv.cash_amount) + to_money(inv.credit_amount))
    cash_refund = to_money(refund_total * to_money(inv.cash_amount) / payable) if payable else ZERO
    credit_reduction = to_money(refund_total - cash_refund)

    ret = SalesReturn(
        document_number=_doc_number(db, SalesReturn, "SRET"),
        sales_invoice_id=sales_invoice_id, value=value, cash_refund=cash_refund,
        family=getattr(inv, "family", None),
        credit_reduction=credit_reduction, ledger_entry_id=None, actor_user_id=actor_user_id,
        branch_id=getattr(inv, "branch_id", None) or branch_for(db, actor_user_id=actor_user_id),
        cost_center_id=getattr(inv, "cost_center_id", None),
    )
    db.add(ret)
    db.flush()
    used_serials: dict[int, int] = {}
    for sold_line, qty in parts:
        item_id = sold_line.item_id
        base_qty = to_qty(qty * to_factor(sold_line.unit_factor))
        back_kind = sold_line.location_kind or inv.origin_location_kind
        back_loc = (sold_line.location_id if sold_line.location_id is not None
                    else inv.origin_location_id)
        stock_service.post_movement(
            db, item_id=item_id, location_kind=back_kind,
            location_id=back_loc, movement_type="sale_return_in",
            direction=StockDirection.in_, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type=StockDoc.SALE_RETURN, source_doc_id=ret.id,
        )
        ret.lines.append(SalesReturnLine(item_id=item_id, quantity=qty,
                                         location_kind=back_kind, location_id=back_loc,
                                         unit_cost=sold_line.unit_cost))
        item = db.get(Item, item_id)
        if item.is_perishable:
            try:
                batch_service.restore_for_return(
                    db, item_id=item_id, location_kind=back_kind, location_id=back_loc,
                    expiry_date=(expiry_dates or {}).get(item_id), quantity=base_qty,
                    invoice_id=inv.id, actor_user_id=actor_user_id,
                )
            except batch_service.BatchError as exc:
                raise SalesError(str(exc)) from exc
        if item.is_serialized:
            all_ser = (serials or {}).get(item_id) or []
            if Decimal(len(all_ser)) != to_qty(wanted[item_id]):
                raise SalesError("عدد السيريالات لازم يساوي الكمية المرتجعة.")
            start = used_serials.get(item_id, 0)
            ser = all_ser[start:start + int(qty)]
            used_serials[item_id] = start + int(qty)
            try:
                serial_service.restore_for_return(
                    db, item=item, invoice_id=inv.id, origin_kind=back_kind,
                    origin_id=back_loc, serials=ser, actor_user_id=actor_user_id,
                )
            except SerialError as exc:
                raise SalesError(str(exc)) from exc

    try:
        cust_acc = customer_service.require_account(
            db, inv.customer_id, family=getattr(inv, "family", None))
    except (MergeError, customer_service.CustomerError) as exc:
        raise SalesError(str(exc)) from exc
    entry_lines = [LineInput(account_resolver.sales_revenue_account(db, branch_id=ret.branch_id).id,
                             Direction.debit, value)]
    if tax_refund > ZERO:
        entry_lines.append(LineInput(tax_service.output_tax_account(db).id, Direction.debit,
                                     tax_refund, statement="رد ضريبة القيمة المضافة"))
    if cash_refund > ZERO:
        entry_lines.append(LineInput(inv.cash_account_id, Direction.credit, cash_refund))
    if credit_reduction > ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.credit, credit_reduction))
    entry = ledger_service.post_entry(
        db, entry_type="sale_return", actor_user_id=actor_user_id, lines=entry_lines,
        rep_id=ret.rep_id, branch_id=ret.branch_id,
        description=entry_text.sale_return(ret.document_number),
        entry_date=ret.return_date,
        partner_kind=PartnerKind.customer, partner_id=inv.customer_id,
        cost_center_id=getattr(inv, "cost_center_id", None),
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="sale.return", actor_user_id=actor_user_id,
                         entity_type="sales_return", entity_id=ret.id, after={"value": str(value)})
    hooks.emit("sale_returned", db, ret, inv)
    return ret


@dataclass(frozen=True)
class ReturnLine:
    item_id: int
    quantity: Decimal
    unit_price: Decimal
    unit: str | None = None
    discount_pct: Decimal | None = None
    warehouse_id: int | None = None
    serials: list[str] | None = None
    fixed_discount_pct: Decimal | None = None
    variable_discount_pct: Decimal | None = None


def create_standalone_return(
    db: Session,
    *,
    customer_id: int,
    origin_location_kind: LocationKind,
    origin_location_id: int,
    variable_discount_pct: Decimal,
    cash_refund: Decimal,
    credit_reduction: Decimal,
    lines: list[ReturnLine],
    actor_role: RoleName,
    actor_user_id: int,
    cash_account_id: int | None = None,
    family: str | None = None,
    rep_id: int | None = None,
    revenue_account_id: int | None = None,
    external_document_number: str | None = None,
    notes: str | None = None,
    statement1: str | None = None,
    statement2: str | None = None,
    statement3: str | None = None,
    return_date=None,
    replace_return_id: int | None = None,
    cost_center_id: int | None = None,
    cost_center_distribution: dict | None = None,
) -> SalesReturn:
    if not lines:
        raise SalesError("المرتجع لازم يكون فيه صنف واحد على الأقل.")
    variable = Decimal(variable_discount_pct)
    if variable < ZERO or variable >= Decimal("100"):
        raise SalesError("خصم الفاتورة لازم يكون من صفر لأقل من ١٠٠٪.")

    customer = db.get(Customer, customer_id)
    if customer is None:
        raise SalesError("العميل مش موجود.")
    try:
        cust_acc = customer_service.require_account(db, customer_id, family=family)
    except (MergeError, customer_service.CustomerError) as exc:
        raise SalesError(str(exc)) from exc

    if (origin_location_kind == LocationKind.warehouse
            and getattr(customer, "default_return_warehouse_id", None) is None):
        customer.default_return_warehouse_id = origin_location_id

    gross = ZERO
    built: list[tuple[ReturnLine, Decimal, Decimal, Decimal]] = []
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None or item.kind != ItemKind.product:
            raise SalesError("المرتجع بيقبل منتجات بس — مش خامات.")
        try:
            factor = uom_service.resolve_factor(db, item, ln.unit)
        except UomError as exc:
            raise SalesError(str(exc)) from exc
        unit_price = to_money(ln.unit_price)
        if unit_price < ZERO:
            raise SalesError("سعر الاسترداد مايكونش بالسالب.")
        line_disc = Decimal(ln.discount_pct) if ln.discount_pct is not None else ZERO
        if line_disc < ZERO or line_disc >= Decimal("100"):
            raise SalesError("خصم السطر لازم يكون من صفر لأقل من ١٠٠٪.")
        line_before = Decimal(ln.quantity) * unit_price
        line_total = discounts.net_of(line_before, line_disc)
        gross += line_total
        built.append((ln, unit_price, line_total, factor))
    gross = to_money(gross)
    fixed = fixed_discount_pct(db)
    net = discounts.apply(gross, fixed, variable)
    tax = tax_service.tax_on(net, tax_service.vat_rate(db))
    refund_total = to_money(net + tax)
    cash_refund = to_money(cash_refund)
    credit_reduction = to_money(credit_reduction)
    gap = refund_total - (cash_refund + credit_reduction)
    if gap != ZERO and abs(gap) <= Decimal("0.05"):
        if credit_reduction + gap >= ZERO:
            credit_reduction += gap
        else:
            cash_refund += gap
    elif gap != ZERO:
        raise SalesError(
            "المرتجع نقدي + اللي بيتخصم من المديونية لازم يساوي صافي المرتجع." if tax == ZERO
            else f"cash refund + credit reduction must equal the total including VAT ({refund_total})."
        )

    cash_acc = (
        (account_resolver.explicit_treasury(db, cash_account_id)
         or account_resolver.resolve_cash_account(
             db, role=actor_role, user_id=actor_user_id, family=family,
             branch_id=branch_for(db, actor_user_id=actor_user_id,
                                  location_kind=origin_location_kind,
                                  location_id=origin_location_id)))
        if to_money(cash_refund) > ZERO else None)

    existing = db.get(SalesReturn, replace_return_id) if replace_return_id else None
    if replace_return_id and existing is None:
        raise SalesError("المرتجع اللي بيتعدّل مش موجود.")

    ret = existing or SalesReturn(
        document_number=_doc_number(db, SalesReturn, "SRET"),
        sales_invoice_id=None, customer_id=customer_id, family=family,
        origin_location_kind=origin_location_kind, origin_location_id=origin_location_id,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind=origin_location_kind,
                             location_id=origin_location_id),
        gross=gross, combined_pct=discounts.combine(fixed, variable), value=net, tax_amount=tax,
        cash_refund=to_money(cash_refund), credit_reduction=to_money(credit_reduction),
        cash_account_id=cash_acc.id if cash_acc else None,
        rep_id=rep_id, revenue_account_id=revenue_account_id,
        external_document_number=(external_document_number or None),
        notes=(notes or None), statement1=(statement1 or None),
        statement2=(statement2 or None), statement3=(statement3 or None),
        return_date=return_date or date.today(),
        cost_center_id=cost_center_id,
        ledger_entry_id=None, actor_user_id=actor_user_id,
    )
    if existing is not None:
        existing.cost_center_id = cost_center_id
        existing.customer_id = customer_id
        existing.family = family
        existing.origin_location_kind = origin_location_kind
        existing.origin_location_id = origin_location_id
        existing.gross = gross
        existing.combined_pct = discounts.combine(fixed, variable)
        existing.value = net
        existing.tax_amount = tax
        existing.cash_refund = to_money(cash_refund)
        existing.credit_reduction = to_money(credit_reduction)
        existing.cash_account_id = cash_acc.id if cash_acc else None
        existing.rep_id = rep_id
        existing.revenue_account_id = revenue_account_id
        existing.external_document_number = (external_document_number or None)
        existing.notes = (notes or None)
        existing.statement1 = (statement1 or None)
        existing.statement2 = (statement2 or None)
        existing.statement3 = (statement3 or None)
        existing.ledger_entry_id = None
        if return_date is not None:
            existing.return_date = return_date
        ret.lines.clear()
    else:
        db.add(ret)
    db.flush()
    for ln, unit_price, line_total, factor in built:
        base_qty = to_qty(Decimal(ln.quantity) * factor)
        back_kind, back_loc = ((LocationKind.warehouse, ln.warehouse_id)
                               if ln.warehouse_id is not None
                               else (origin_location_kind, origin_location_id))
        stock_service.post_movement(
            db, item_id=ln.item_id, location_kind=back_kind,
            location_id=back_loc, movement_type="sale_return_in",
            direction=StockDirection.in_, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type=StockDoc.SALE_RETURN, source_doc_id=ret.id,
        )
        if item is not None and item.is_serialized:
            ser = [s.strip() for s in (ln.serials or []) if s.strip()]
            if len(set(ser)) != len(ser):
                raise SalesError(f"«{item.name}»: فيه سيريال مكرر في المرتجع.")
            if len(ser) != int(base_qty):
                raise SalesError(
                    f"«{item.name}»: اكتب {int(base_qty)} سيريال بعدد الكمية — "
                    "هما اللي بيرجعوا للمخزن.")
            serial_service.restore_free(
                db, item=item, origin_kind=back_kind, origin_id=back_loc,
                serials=ser, document_id=ret.id, actor_user_id=actor_user_id)
        ret.lines.append(SalesReturnLine(
            item_id=ln.item_id, quantity=Decimal(ln.quantity), unit_price=unit_price,
            discount_pct=(Decimal(ln.discount_pct) if ln.discount_pct is not None else ZERO),
            fixed_discount_pct=ln.fixed_discount_pct,
            variable_discount_pct=ln.variable_discount_pct,
            line_total=line_total, unit=ln.unit, unit_factor=factor,
            location_kind=back_kind, location_id=back_loc,
            unit_cost=to_money(costing_service.average_cost(db, ln.item_id) * factor),
        ))

    entry_lines = [LineInput(account_resolver.sales_revenue_account(db, branch_id=ret.branch_id).id,
                             Direction.debit, net)]
    if tax > ZERO:
        entry_lines.append(LineInput(tax_service.output_tax_account(db).id, Direction.debit,
                                     tax, statement="رد ضريبة القيمة المضافة"))
    if to_money(cash_refund) > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.credit, to_money(cash_refund)))
    if to_money(credit_reduction) > ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.credit, to_money(credit_reduction)))
    entry = ledger_service.post_entry(
        db, entry_type="sale_return", actor_user_id=actor_user_id, lines=entry_lines,
        rep_id=ret.rep_id, branch_id=ret.branch_id,
        description=entry_text.sale_return(ret.document_number),
        entry_date=ret.return_date,
        partner_kind=PartnerKind.customer, partner_id=ret.customer_id,
        cost_center_id=getattr(ret, "cost_center_id", None),
        cost_center_distribution=cost_center_distribution,
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="sale.return_standalone", actor_user_id=actor_user_id,
                         entity_type="sales_return", entity_id=ret.id, after={"value": str(net)})
    hooks.emit("standalone_return_created", db, ret)
    return ret


def last_sold_price(db: Session, *, customer_id: int, item_id: int) -> dict | None:
    rows = db.execute(
        select(
            SalesInvoice.document_number, SalesInvoice.created_at,
            SalesInvoiceLine.quantity, SalesInvoiceLine.unit_price,
            SalesInvoiceLine.line_total, SalesInvoiceLine.unit,
        )
        .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
        .where(SalesInvoice.customer_id == customer_id, SalesInvoiceLine.item_id == item_id)
        .order_by(SalesInvoice.id.desc())
        .limit(10)
    ).all()
    if not rows:
        return None
    history = []
    for doc, created_at, qty, unit_price, line_total, unit in rows:
        q = Decimal(str(qty)) or Decimal("1")
        effective = to_money(Decimal(str(line_total)) / q) if q else to_money(unit_price)
        history.append({
            "document_number": doc,
            "date": created_at.isoformat() if created_at else None,
            "quantity": str(qty), "unit": unit,
            "unit_price": str(to_money(unit_price)),
            "effective_price": str(effective),
        })
    return {"last_price": history[0]["effective_price"], "history": history}
