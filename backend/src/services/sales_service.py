"""Sales service (T035–T036). FR-017–021.

Sale: combined-% discount once on gross; split cash/credit to ONE balanced entry (debit cash-location
+ customer receivable; credit sales_revenue). Return: partial; money reversed proportionally to the
original invoice's cash/credit split (research R9).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core import hooks
from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item, ItemKind, PriceTier
from src.models.customer import Customer, CustomerAccount
from src.services import customer_merge_service
from src.services.customer_merge_service import MergeError
from src.models.ledger import Account, Direction
from src.models.role import RoleName
from src.models.sales import (
    SalesInvoice,
    SalesInvoiceLine,
    SalesReturn,
    SalesReturnLine,
    SalesSetting,
)
from src.models.sales_expense import ExpenseKind, SalesInvoiceExpense
from src.models.stock import LocationKind, StockDirection
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
    tier: PriceTier | None = None          # (007) explicit tier override per line
    unit_price: Decimal | None = None      # (007) manual price override (below-tier needs capability)
    unit: str | None = None                # (008) unit of measure; None = base unit
    serials: list[str] | None = None       # (009) serial numbers (required for serialized items)
    # (027) per-line discount %. None = use the item's fixed default; a number overrides it
    # (the caller adds the item fixed + a typed variable and sends the total here).
    discount_pct: Decimal | None = None
    # (030) the warehouse THIS line is served from. None = the document's own location, which is
    # what every pre-030 caller sends and what a rep selling from his custody still uses.
    warehouse_id: int | None = None


def _revenue_account_id(db: Session, chosen: int | None) -> int:
    """The account revenue posts to: the one named on the document, else the system default.

    A chosen account must be postable — posting to a group account would silently corrupt the
    trial balance, so it is refused up front rather than discovered at report time.
    """
    if chosen is None:
        return account_resolver.sales_revenue_account(db).id
    from src.models.ledger import Account

    acc = db.get(Account, chosen)
    if acc is None or not acc.active:
        raise SalesError("حساب الإيراد مش موجود.")
    if not acc.is_postable:
        raise SalesError("حساب الإيراد ده مجموعة مش حساب — اختار حساب بيقبل الترحيل.")
    return acc.id


def _line_location(ln: SaleLine, doc_kind: LocationKind, doc_id: int) -> tuple[LocationKind, int]:
    """Where a line moves stock: its own warehouse when given, else the document's location."""
    if ln.warehouse_id is not None:
        return LocationKind.warehouse, ln.warehouse_id
    return doc_kind, doc_id


def _split_expenses(db, expenses: list[dict] | None) -> tuple[Decimal, Decimal]:
    """Total the invoice's expenses per kind, rejecting anything unpostable.

    The account has to be a postable leaf: an expense aimed at a group heading would balance the
    entry and still be unreadable in every report built on the chart.
    """
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
    """How many coupons the range covers.

    A typed count wins — the person at the counter can see the book. Otherwise it is derived,
    but ONLY when both serials are plain numbers: coupon books elsewhere use prefixes and letters,
    and subtracting those would invent a count that nobody can check against the paper.
    """
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
    """Reject the document if the SUM of its lines exceeds what a location has FREE.

    Checking a line at a time would let two lines of 3 through against a stock of 5: each looks
    affordable on its own. Stock is grouped per (item × location) first, so the document is
    refused as a whole before anything moves.

    (031) Free, not merely on-hand: stock held by a live reservation for a DIFFERENT customer is
    not available to this sale. Excluding this customer's own holds is what makes the reservation
    worth anything — otherwise it would block the one sale it exists to guarantee.
    """
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
                f"No-negative-stock: on-hand {on_hand} < requested out {needed} "
                f"(item {item_id}, {kind.value} {loc_id})."
            )


def _doc_number(db: Session, model, prefix: str) -> str:
    return numbering.next_document_number(db, model, prefix)


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
    # `None` = احسبه من المستحق ناقص النقدي. الرقم الصريح لسه بيتقبل ويتفحص.
    credit_amount: Decimal | None = None,
    lines: list[SaleLine],
    actor_role: RoleName,
    actor_user_id: int,
    # (031) أبيض ولا بولي — which of the customer's accounts this document belongs to. None on a
    # customer who has only ever had one, which is every customer who was never split.
    family: str | None = None,
    can_sell_below: bool = False,
    # (030) document fields — all optional so every pre-030 caller keeps working unchanged.
    rep_id: int | None = None,
    revenue_account_id: int | None = None,
    external_document_number: str | None = None,
    notes: str | None = None,
    statement1: str | None = None,
    statement2: str | None = None,
    statement3: str | None = None,
    # Coupons handed over with this invoice, as the serial range off the book.
    coupon_serial_from: str | None = None,
    coupon_serial_to: str | None = None,
    # فيه صفوف كوبونات هتتكتب بعد المستند — الفحص محتاج يعرف بيها.
    has_coupon_rows: bool = False,
    coupon_count: int | None = None,
    # The day the sale happened. It dates the document AND its ledger entry, because a document
    # dated one day and posted on another makes every statement disagree with the paper.
    invoice_date=None,
    # مصروفات الفاتورة: [{account_id, kind: billed|operating, amount, description}]
    expenses: list[dict] | None = None,
    # (033) رقم الجهاز — بيتخزّن زي ما هو، والـUNIQUE عليه هي اللي بتمنع التكرار.
    client_uuid: str | None = None,
    # التعديل الحر: الفاتورة دي تتبني من جديد **مكان** فاتورة موجودة — بنفس الرقم ونفس
    # الـid. أثر القديمة بيتشال قبل البناء (شوف `document_edit_service`)، فاللي بيطلع في
    # الآخر مستند واحد، مش مستند وتصحيحه.
    replace_invoice_id: int | None = None,
) -> SalesInvoice:
    # فاتورة كوبونات بس — من غير أي صنف.
    #
    # الشركة بتسلّم دفاتر كوبونات لعميل من غير ما تبيعه بضاعة في نفس الورقة، وده مستند
    # حقيقي: بيتسجّل عليه مين استلم وإمتى وأنهي مدى أرقام. المنع القديم كان بيخلّي الحالة
    # دي تتكتب كفاتورة بصنف وهمي بصفر — وده بيدخل صنف مالوش وجود في تقارير المبيعات.
    #
    # اللي بيتفحص هنا إن المستند مش فاضي، مش إن فيه أصناف: صنف أو كوبونات أو الاتنين.
    # الحقول المسطّحة دي شكل قديم لدفتر واحد. الشاشة بقت بتبعت **صفوف** كوبونات
    # (`body.coupons`) — دفتر لكل صف — وبتتكتب بعد ما الفاتورة تتعمل، يعني الفحص هنا
    # عمره ما شافها. النتيجة إن فاتورة كوبونات بس كانت بتترفض بـ«لازم يكون فيها صنف
    # أو دفتر كوبونات» والدفتر مكتوب قدام اللي بيدخل. الطبقة اللي فوق بتقول إن فيه
    # صفوف جاية عشان الفحص يحكم على المستند كله مش على نصه.
    has_coupons = bool(coupon_serial_from or coupon_serial_to or coupon_count
                       or has_coupon_rows)
    if not lines and not has_coupons:
        raise SalesError("الفاتورة لازم يكون فيها صنف أو دفتر كوبونات على الأقل.")
    fixed = fixed_discount_pct(db)
    variable = Decimal(variable_discount_pct)
    combined = fixed + variable
    if combined >= Decimal("100") or variable < ZERO:
        raise SalesError("الخصم المجمّع لازم يكون أقل من ١٠٠٪ والخصم المتغيّر مايكونش بالسالب.")

    customer = db.get(Customer, customer_id)

    gross = ZERO
    # (007) price resolves from a tier (override per line); below-tier needs sell.below_price.
    # (008) a unit may be chosen: the list price = base-tier price × factor; stock moves in base units
    # (= entered qty × factor). The line records tier + actual price + unit + factor.
    built: list[tuple[SaleLine, Decimal, Decimal, PriceTier, Decimal, Decimal]] = []
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None or item.kind != ItemKind.product:
            raise SalesError("البيع بيقبل منتجات بس — مش خامات.")
        try:
            factor = uom_service.resolve_factor(db, item, ln.unit)
        except UomError as exc:
            raise SalesError(str(exc)) from exc
        # (011) A batch quantity is expressed in base units, so a perishable line must be too —
        # otherwise the lot arithmetic and the stock movement would disagree.
        if item.is_perishable and factor != Decimal("1"):
            raise SalesError("الأصناف اللي ليها صلاحية بتتباع بوحدتها الأساسية.")
        try:  # (009) validate serial count/base-unit/serialized consistency before any stock move
            serial_service.assert_sale_serials(
                item, quantity=ln.quantity, unit_factor=factor, serials=ln.serials
            )
        except SerialError as exc:
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
                f"البيع بأقل من سعر الشريحة ({list_price}) محتاج صلاحية "
                f"«البيع تحت السعر» — مالكش الصلاحية دي."
            )
        # (031) Which discount the line takes, most specific first:
        #
        #   1. what was typed on THIS line — a one-off agreed at the counter;
        #   2. the CUSTOMER's own rate, when he has one;
        #   3. the ITEM's default;
        #   4. none.
        #
        # The customer's rate REPLACES the item's rather than stacking on it. A dealer on 20%
        # against an item that gives 10% is on twenty, not twenty-eight — «خصمه» is the rate
        # agreed with him, not a bonus added to whatever the item already gave.
        #
        # Empty is what makes this readable: NULL on the customer means «nothing agreed with him»
        # and the item's rate applies, while 0 means «agreed, and it is nothing» and the item's
        # rate is deliberately cancelled. A column defaulted to zero could not tell those apart,
        # which is why the customer's discount is nullable.
        line_disc = (Decimal(ln.discount_pct) if ln.discount_pct is not None
                     else Decimal(customer.discount_pct) if customer.discount_pct is not None
                     else Decimal(item.default_discount_pct or 0))
        if line_disc < ZERO or line_disc >= Decimal("100"):
            raise SalesError("خصم السطر لازم يكون من صفر لأقل من ١٠٠٪.")
        line_before = Decimal(ln.quantity) * unit_price
        line_total = to_money(line_before * (Decimal("1") - line_disc / Decimal("100")))
        gross += line_total
        built.append((ln, unit_price, line_total, tier, factor, line_disc))
    gross = to_money(gross)
    net = compute_net(gross, combined)
    # VAT (021): zero rate ⇒ tax 0 and `payable == net`, i.e. the original contract exactly.
    tax = tax_service.tax_on(net, tax_service.vat_rate(db))
    billed_expenses, operating_expenses = _split_expenses(db, expenses)
    # A billed expense is money the customer owes, so it is part of what has to be paid. An
    # operating expense is ours — it never changes his side of the document.
    payable = to_money(net + tax + billed_expenses)

    # الآجل بيتحسب، مايتكتبش.
    #
    # الشرط القديم كان «النقدي + الآجل = الصافي بالظبط»، وده كان بيرفض فواتير سليمة لسببين:
    #
    # * **الضريبة والمصروفات.** الشاشة بتحسب صافي السطور، والسيرفر بيحسب المستحق = الصافي
    #   + الضريبة + مصروفات العميل. أول ما يبقى فيه ضريبة أو مصروف، الرقمين بيختلفوا
    #   والفاتورة بتترفض من غير ما اللي قدامها يعرف ليه.
    # * **الدفع الزيادة.** العميل بيدي ١٠٠٠ على فاتورة ٢٥٠، والزيادة بتنزل رصيد ليه. النظام
    #   القديم بتاع الشركة بيقبلها ويكتب الباقي بالسالب — شفنا فواتير حقيقية كده عندهم.
    #
    # فالنقدي هو اللي بيتقال، والآجل بيتحسب: `المستحق − النقدي`. والسالب مقصود — القيد
    # تحته بيعرفه ويقيّده لصالح العميل.
    cash = to_money(cash_amount)
    if credit_amount is None:
        credit_amount = payable - cash
    elif to_money(cash) + to_money(credit_amount) != payable:
        raise SalesError(
            f"النقدي + الآجل لازم يساوي المستحق ({payable})."
        )

    # (031) Which of his accounts this invoice belongs to. A customer may hold one per product
    # line now, and an unscoped lookup would post to an arbitrary one of them.
    try:
        cust_acc = customer_merge_service.receivable_account(db, customer_id, family)
    except MergeError as exc:
        raise SalesError(str(exc)) from exc
    if cust_acc is None:
        raise SalesError("العميل ده مالوش حساب ذمم.")
    cash_acc = account_resolver.resolve_cash_account(db, role=actor_role, user_id=actor_user_id)

    # الفاتورة اللي بتتعدّل بتحتفظ برقمها وتاريخ إنشائها — الرقم ده اتطبع واتقال في
    # التليفون، وتغييره عشان سعر اتظبط بيخلّي الورقة اللي في إيد العميل تشاور على حاجة
    # مش موجودة.
    existing = db.get(SalesInvoice, replace_invoice_id) if replace_invoice_id else None
    if replace_invoice_id and existing is None:
        raise SalesError("الفاتورة اللي بتتعدّل مش موجودة.")

    invoice = existing or SalesInvoice(
        document_number=_doc_number(db, SalesInvoice, "SINV"),
        customer_id=customer_id, origin_location_kind=origin_location_kind,
        origin_location_id=origin_location_id, gross=gross, fixed_discount_pct=fixed,
        family=family,
        variable_discount_pct=variable, combined_pct=combined, net=net, tax_amount=tax,
        cash_amount=to_money(cash_amount), credit_amount=to_money(credit_amount),
        cash_account_id=cash_acc.id, ledger_entry_id=None, actor_user_id=actor_user_id,
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind=origin_location_kind,
                             location_id=origin_location_id),
        # (030) Falls back to the seller's own rep id, so the document always names someone.
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
    )
    if existing is not None:
        # نفس الحقول اللي البناء بيملاها، بس على صف موجود. `client_uuid` مابيتلمسش —
        # هو بصمة الجهاز اللي بعت الفاتورة أول مرة، والتعديل من الشاشة مش إرسال جديد.
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
        if invoice_date is not None:
            existing.invoice_date = invoice_date
        invoice.lines.clear()
    else:
        db.add(invoice)
    db.flush()
    # (030) Every line may draw from its own warehouse, so check the whole document against each
    # location BEFORE moving anything — see `_assert_lines_available`.
    _assert_lines_available(db, [
        (ln.item_id, *_line_location(ln, origin_location_kind, origin_location_id),
         to_qty(Decimal(ln.quantity) * factor))
        for ln, _price, _total, _tier, factor, _disc in built
    ], customer_id=customer_id)
    for ln, unit_price, line_total, tier, factor, line_disc in built:
        base_qty = to_qty(Decimal(ln.quantity) * factor)  # (008) stock moves in the base unit
        line_kind, line_loc = _line_location(ln, origin_location_kind, origin_location_id)
        stock_service.post_movement(
            db, item_id=ln.item_id, location_kind=line_kind,
            location_id=line_loc, movement_type="sale_out",
            direction=StockDirection.out, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type="sale", source_doc_id=invoice.id,
        )
        # (030) Freeze the cost of goods as it stands NOW. Later purchases move the average for
        # future sales; this invoice's margin must stay exactly what it was on the day.
        unit_cost = to_money(costing_service.average_cost(db, ln.item_id) * factor)
        invoice.lines.append(
            SalesInvoiceLine(item_id=ln.item_id, quantity=ln.quantity,
                             unit_price=unit_price, discount_pct=line_disc,
                             line_total=line_total, price_tier=tier,
                             unit=ln.unit, unit_factor=factor,
                             location_kind=line_kind, location_id=line_loc,
                             unit_cost=unit_cost)
        )
        if ln.serials:  # (009) mark the specific serials sold (validated above)
            item = db.get(Item, ln.item_id)
            try:
                serial_service.mark_sold(
                    db, item=item, origin_kind=line_kind, origin_id=line_loc,
                    serials=ln.serials, invoice_id=invoice.id,
                    actor_user_id=actor_user_id,
                )
            except SerialError as exc:
                raise SalesError(str(exc)) from exc
        # (011) A perishable line also draws down its lots, earliest expiry first, so the batch
        # sum keeps matching the on-hand the movement above just reduced.
        line_item = db.get(Item, ln.item_id)
        if line_item.is_perishable:
            try:
                batch_service.consume_fefo(
                    db, item_id=ln.item_id, location_kind=line_kind,
                    location_id=line_loc, quantity=base_qty,
                    document_type="sales_invoice", document_id=invoice.id,
                    actor_user_id=actor_user_id,
                )
            except batch_service.BatchError as exc:
                raise SalesError(str(exc)) from exc

    entry_lines = []
    if to_money(cash_amount) > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.debit, to_money(cash_amount)))
    credit = to_money(credit_amount)
    if credit > ZERO:
        # Part of this invoice is on credit — it adds to what the customer owes.
        entry_lines.append(LineInput(cust_acc.account_id, Direction.debit, credit))
    elif credit < ZERO:
        # The customer paid MORE than this invoice: the surplus settles his prior balance, so it
        # credits (reduces) his receivable. His overall account total drops by that surplus.
        entry_lines.append(LineInput(cust_acc.account_id, Direction.credit, -credit))
    # (030) Revenue posts to the account chosen on the document when there is one, so a company
    # can split sales across several revenue accounts; otherwise the system's default.
    if net > ZERO:
        entry_lines.append(LineInput(_revenue_account_id(db, revenue_account_id),
                                     Direction.credit, net))
    if tax > ZERO:  # output VAT is owed to the authority, not revenue
        entry_lines.append(LineInput(tax_service.output_tax_account(db).id,
                                     Direction.credit, tax, statement="ضريبة القيمة المضافة"))
    for exp in (expenses or []):
        amount = to_money(exp.get("amount") or 0)
        if amount <= ZERO:
            continue
        account_id = int(exp["account_id"])
        if str(exp.get("kind", "billed")) == "operating":
            # Ours to bear: the expense is incurred and paid out of the same till the sale was
            # received into. Debit expense / credit cash — the pair balances on its own, so it
            # leaves the customer's side of the invoice untouched.
            entry_lines.append(LineInput(account_id, Direction.debit, amount,
                                         statement=exp.get("description") or "مصروف تشغيل"))
            entry_lines.append(LineInput(cash_acc.id, Direction.credit, amount,
                                         statement=exp.get("description") or "مصروف تشغيل"))
        else:
            # Charged to him: he already pays it via cash/credit above, so this is the other side.
            entry_lines.append(LineInput(account_id, Direction.credit, amount,
                                         statement=exp.get("description") or "مصروف على العميل"))
    if entry_lines:
        entry = ledger_service.post_entry(
            db, entry_type="sale", actor_user_id=actor_user_id, lines=entry_lines,
            rep_id=invoice.rep_id,
            description=f"Sale {invoice.document_number}",
            # Same date as the document: the books and the paper have to agree.
            entry_date=invoice_date,
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
    # Additive cross-feature hook (no-op if no subscriber, e.g. 002-only deploy). 003 loyalty earns here.
    hooks.emit("sale_created", db, invoice)
    return invoice


def _already_returned(db: Session, invoice_id: int) -> dict[int, Decimal]:
    """الكمية اللي رجعت فعلاً من كل صنف على الفاتورة دي.

    **المرتجع المعكوس مابيتحسبش.** ده مش تفصيلة: من غير الشرط ده، مرتجع اتعمل بالغلط
    واتعكس بيفضل قافل الكمية بتاعته للأبد — الصنف رجع للمخزن وقت العكس، وبرضه النظام
    بيقول إنه مرجّع ويرفض إنه يترجّع تاني. نفس الشرط بالحرف في `purchase_service`.
    """
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
    """عكس مرتجع مبيعات مرحّل — البضاعة تخرج تاني واللي على العميل يرجع زي ما كان.

    نسخة بالحرف من `purchase_service.reverse_purchase_return`، بالعكس: هناك المردود طلّع
    بضاعة فالعكس بيرجّعها، وهنا المرتجع دخّل بضاعة فالعكس بيطلّعها.

    والعكس **إضافة** مش مسح، في الحتّتين:

    * حركة مخزن خارجة لكل سطر، من نفس المخزن اللي دخلته. `sale_return_in` دخّل البضاعة
      لمخزن بعينه — لو خرجت من مخزن تاني يبقى الرصيدين الاتنين غلط.
    * قيد مضاد عن طريق `ledger_service.reverse_entry`، مش قيد جديد مكتوب بالإيد: لو اتكتب
      بالإيد يبقى فيه نسختين من نفس الحسبة، وأول ما حسبة المرتجع تتغيّر تفضل واحدة قديمة.

    والصف بيفضل موجود بعلامة `reversed_at` — ودي هي اللي بتفكّ الكمية عشان الصنف يقدر
    يترجّع من جديد (شوف `_already_returned`).
    """
    ret = db.get(SalesReturn, return_id)
    if ret is None:
        raise SalesError("المرتجع مش موجود.")
    if ret.reversed_at is not None:
        raise SalesError("المرتجع ده اتعكس قبل كده.")

    inv = db.get(SalesInvoice, ret.sales_invoice_id) if ret.sales_invoice_id else None
    if ret.sales_invoice_id and inv is None:
        raise SalesError("فاتورة البيع بتاعت المرتجع مش موجودة.")

    # معامل الوحدة: السطر المستقل شايله بنفسه، والمربوط بفاتورة بيتاخد من سطر الفاتورة —
    # لأن الكمية على السطر متسجّلة بوحدة البيع مش بالوحدة الأساسية، والمخزن بيتحرك بالأساسية.
    factors = {ln.item_id: to_qty(ln.unit_factor) for ln in inv.lines} if inv else {}

    for line in ret.lines:
        out_kind = line.location_kind
        out_loc = line.location_id
        if out_kind is None or out_loc is None:
            out_kind, out_loc = ret.origin_location_kind, ret.origin_location_id
        if out_kind is None or out_loc is None:
            raise SalesError("المرتجع ده مالوش مخزن مسجّل — مايتعكسش.")
        factor = (to_qty(line.unit_factor) if getattr(line, "unit_factor", None) is not None
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
    """أي دفعات الصنف ده اللي الفاتورة دي خدت منها — والكمية من كل واحدة.

    FEFO chooses lots at the moment of sale and writes each draw down. A reversal must put the
    goods back into the SAME lots, so it reads that trail instead of asking somebody to retype an
    expiry date they were never told.

    Netted against anything already returned on this invoice, so reversing an invoice that had a
    partial return does not try to give back more of a lot than left it.
    """
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
    """السيريالات اللي لسه متسجّلة إنها اتباعت على الفاتورة دي.

    Same idea as the lots: the sale recorded which units went out, so a reversal reads them rather
    than asking. Ones already returned are no longer marked sold against this invoice and drop out
    on their own.
    """
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
    """عكس فاتورة بالكامل — للتعديل أو للإلغاء.

    A reversal is NOT a customer return, and treating it as one is what made «تعديل» fail on
    perfectly ordinary invoices. A real return has to ask questions the shop cannot answer for the
    customer — which lot did these goods come from, which serial numbers came back — because the
    customer is handing over goods whose history nobody watched.

    A reversal has none of that uncertainty. It is undoing THIS invoice, so the lots it drew from
    and the serials it sold are already written down, and asking a user to retype them is asking
    them to guess at facts the system holds. That is why editing an invoice with a perishable item
    used to stop at «المرتجع لصنف له صلاحية لازم تكتب تاريخ صلاحية البضاعة الراجعة»: nothing on
    the edit screen could have known the answer, and the answer was in the database.

    So this fills in every answer from the invoice and hands the whole thing to `return_sale`,
    which stays the single place that knows how to give goods and money back. One posting path,
    two entry points.
    """
    inv = db.get(SalesInvoice, sales_invoice_id)
    if inv is None:
        raise SalesError("فاتورة البيع مش موجودة.")

    prior = _already_returned(db, sales_invoice_id)
    lines: list[tuple[int, Decimal]] = []
    expiry_dates: dict = {}
    serials: dict[int, list[str]] = {}

    for ln in inv.lines:
        # What is LEFT to reverse — an invoice with a partial return against it reverses only the
        # remainder, instead of being refused for exceeding the sold quantity.
        remaining = to_qty(Decimal(ln.quantity) - prior.get(ln.item_id, ZERO))
        if remaining <= ZERO:
            continue
        lines.append((ln.item_id, remaining))
        item = db.get(Item, ln.item_id)
        if item is not None and item.is_perishable:
            lots = sold_lots(db, sales_invoice_id, ln.item_id)
            if lots:
                # `return_sale` puts a line back into ONE lot. Where a line drew on several, the
                # earliest expiry is the honest choice: it is the lot FEFO emptied first, so it is
                # the one with room for the goods coming back.
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
    serials: dict[int, list[str]] | None = None,  # (009) item_id → serials being returned
    # (011) item_id → expiry date of the perishable goods coming back. Required for a perishable
    # item, because a sale does not record which lot each unit came from.
    expiry_dates: dict[int, object] | None = None,
) -> SalesReturn:
    inv = db.get(SalesInvoice, sales_invoice_id)
    if inv is None:
        raise SalesError("فاتورة البيع مش موجودة.")
    # (008) carry the line's unit_factor so the return reverses stock in base units.
    sold = {
        ln.item_id: (Decimal(ln.quantity), to_money(ln.unit_price), to_qty(ln.unit_factor))
        for ln in inv.lines
    }
    # (030) Each sold line remembers the warehouse it left from, so the return puts the goods back
    # exactly there. Lines written before 030 fall back to the invoice's own location.
    sold_from = {
        ln.item_id: (ln.location_kind or inv.origin_location_kind,
                     ln.location_id if ln.location_id is not None else inv.origin_location_id)
        for ln in inv.lines
    }
    # (030) The cost the SALE booked — a return has to reverse that, not today's average.
    sold_cost = {ln.item_id: ln.unit_cost for ln in inv.lines}
    prior = _already_returned(db, sales_invoice_id)

    value = ZERO
    for item_id, qty in lines:
        qty = Decimal(qty)
        if item_id not in sold:
            raise SalesError("الصنف ده مش على الفاتورة دي أصلاً.")
        if prior.get(item_id, ZERO) + qty > sold[item_id][0]:
            # Arabic, because this one reaches a person. It fires most often on «تعديل» for an
            # invoice that has already been returned in full, and «Cumulative return exceeds sold
            # quantity» told them nothing about which invoice, which item, or what to do next.
            raise SalesError(
                f"مرتجعات الفاتورة دي وصلت للكمية المباعة خلاص — "
                f"اتباع {sold[item_id][0]} واترجّع {prior.get(item_id, ZERO)} قبل كده.")
        value += to_money(qty * sold[item_id][1])
    value = to_money(value)

    # VAT (021): a partial return gives back the same share of the tax that was charged, so a
    # full return leaves neither revenue nor tax behind.
    invoice_tax = to_money(getattr(inv, "tax_amount", ZERO) or ZERO)
    tax_refund = to_money(value * invoice_tax / to_money(inv.net)) if inv.net and invoice_tax else ZERO
    refund_total = to_money(value + tax_refund)

    # Proportional split from the ORIGINAL invoice's cash/credit composition (of what was payable).
    payable = to_money(to_money(inv.cash_amount) + to_money(inv.credit_amount))
    cash_refund = to_money(refund_total * to_money(inv.cash_amount) / payable) if payable else ZERO
    credit_reduction = to_money(refund_total - cash_refund)

    ret = SalesReturn(
        document_number=_doc_number(db, SalesReturn, "SRET"),
        sales_invoice_id=sales_invoice_id, value=value, cash_refund=cash_refund,
        # Copied off the invoice, not resolved again: the refund has to reduce the same debt the
        # sale raised, even for a customer whose accounts were split afterwards.
        family=getattr(inv, "family", None),
        credit_reduction=credit_reduction, ledger_entry_id=None, actor_user_id=actor_user_id,
        # المرتجع بياخد فرع فاتورته: البضاعة رجعت للمكان اللي خرجت منه.
        branch_id=getattr(inv, "branch_id", None) or branch_for(db, actor_user_id=actor_user_id),
    )
    db.add(ret)
    db.flush()
    for item_id, qty in lines:
        base_qty = to_qty(Decimal(qty) * sold[item_id][2])  # (008) reverse stock in base units
        back_kind, back_loc = sold_from[item_id]            # (030) back to where it left from
        stock_service.post_movement(
            db, item_id=item_id, location_kind=back_kind,
            location_id=back_loc, movement_type="sale_return_in",
            direction=StockDirection.in_, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type="sale_return", source_doc_id=ret.id,
        )
        ret.lines.append(SalesReturnLine(item_id=item_id, quantity=Decimal(qty),
                                         location_kind=back_kind, location_id=back_loc,
                                         unit_cost=sold_cost.get(item_id)))
        item = db.get(Item, item_id)  # (009) restore serials for serialized items
        if item.is_perishable:
            # (011) Goods come back into the lot for their expiry, matching the stock-in above.
            try:
                batch_service.restore_for_return(
                    db, item_id=item_id, location_kind=back_kind, location_id=back_loc,
                    expiry_date=(expiry_dates or {}).get(item_id), quantity=base_qty,
                    invoice_id=inv.id, actor_user_id=actor_user_id,
                )
            except batch_service.BatchError as exc:
                raise SalesError(str(exc)) from exc
        if item.is_serialized:
            ser = (serials or {}).get(item_id) or []
            if Decimal(len(ser)) != to_qty(Decimal(qty)):
                raise SalesError("عدد السيريالات لازم يساوي الكمية المرتجعة.")
            try:
                serial_service.restore_for_return(
                    db, item=item, invoice_id=inv.id, origin_kind=back_kind,
                    origin_id=back_loc, serials=ser, actor_user_id=actor_user_id,
                )
            except SerialError as exc:
                raise SalesError(str(exc)) from exc

    # The return goes back to the SAME account the invoice posted to — read off the invoice rather
    # than resolved again, so a customer whose lines were split later still gets his money back
    # where it came from.
    cust_acc = customer_merge_service.receivable_account(
        db, inv.customer_id, getattr(inv, "family", None))
    entry_lines = [LineInput(account_resolver.sales_revenue_account(db).id, Direction.debit, value)]
    if tax_refund > ZERO:
        entry_lines.append(LineInput(tax_service.output_tax_account(db).id, Direction.debit,
                                     tax_refund, statement="رد ضريبة القيمة المضافة"))
    if cash_refund > ZERO:
        entry_lines.append(LineInput(inv.cash_account_id, Direction.credit, cash_refund))
    if credit_reduction > ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.credit, credit_reduction))
    entry = ledger_service.post_entry(
        db, entry_type="sale_return", actor_user_id=actor_user_id, lines=entry_lines,
        rep_id=ret.rep_id,
        description=f"Sales return {ret.document_number}",
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
    unit_price: Decimal                    # the refunded price per unit (defaults to last sold price)
    unit: str | None = None                # (008) unit of measure; None = base unit
    discount_pct: Decimal | None = None    # (027) per-line discount; None = 0 (refund the actual price)
    # (030) the warehouse THIS line comes back into; None = the document's location
    warehouse_id: int | None = None
    # (009) المرتجع الحر: سيريالات الوحدات المرتجعة لأصناف مسلسلة — بدون ربط بفاتورة.
    serials: list[str] | None = None


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
    # (031) أبيض ولا بولي — which of the customer's accounts this document belongs to. None on a
    # customer who has only ever had one, which is every customer who was never split.
    family: str | None = None,
    # (031) The same document fields the invoice carries. They were on the table since 030 and
    # nothing could fill them: the payload dropped them, so every return was written with the
    # rep, the posting account and the paper trail blank.
    rep_id: int | None = None,
    revenue_account_id: int | None = None,
    external_document_number: str | None = None,
    notes: str | None = None,
    statement1: str | None = None,
    statement2: str | None = None,
    statement3: str | None = None,
    return_date=None,
    # التعديل الحر — نفس فكرة الفاتورة: المرتجع يتبني مكان واحد موجود بنفس رقمه.
    replace_return_id: int | None = None,
) -> SalesReturn:
    """A sales return built like a sale but reversed (028): pick a customer + items directly (no
    originating invoice), goods go back INTO stock, and the customer is credited (cash refund from a
    treasury and/or a reduction of what they owe). Prices default to what the customer last paid.
    """
    if not lines:
        raise SalesError("المرتجع لازم يكون فيه صنف واحد على الأقل.")
    variable = Decimal(variable_discount_pct)
    if variable < ZERO or variable >= Decimal("100"):
        raise SalesError("خصم الفاتورة لازم يكون من صفر لأقل من ١٠٠٪.")

    customer = db.get(Customer, customer_id)
    if customer is None:
        raise SalesError("العميل مش موجود.")
    try:
        cust_acc = customer_merge_service.receivable_account(db, customer_id, family)
    except MergeError as exc:
        raise SalesError(str(exc)) from exc
    if cust_acc is None:
        raise SalesError("العميل ده مالوش حساب ذمم.")

    # (031) Remember where this customer's returns come back to, the FIRST time it is answered.
    # His goods come back to the branch that serves him, and asking again on every return is
    # asking a question whose answer has not changed.
    #
    # First time only, never overwritten: a one-off return taken at another store would otherwise
    # silently become his default, and the next person would find a store nobody chose.
    if (origin_location_kind == LocationKind.warehouse
            and getattr(customer, "default_return_warehouse_id", None) is None):
        customer.default_return_warehouse_id = origin_location_id

    gross = ZERO
    built: list[tuple[ReturnLine, Decimal, Decimal, Decimal]] = []  # (line, unit_price, line_total, factor)
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
        line_total = to_money(line_before * (Decimal("1") - line_disc / Decimal("100")))
        gross += line_total
        built.append((ln, unit_price, line_total, factor))
    gross = to_money(gross)
    net = compute_net(gross, variable)
    tax = tax_service.tax_on(net, tax_service.vat_rate(db))
    refund_total = to_money(net + tax)
    if to_money(cash_refund) + to_money(credit_reduction) != refund_total:
        raise SalesError(
            "المرتجع نقدي + اللي بيتخصم من المديونية لازم يساوي صافي المرتجع." if tax == ZERO
            else f"cash refund + credit reduction must equal the total including VAT ({refund_total})."
        )

    cash_acc = (account_resolver.resolve_cash_account(db, role=actor_role, user_id=actor_user_id)
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
        gross=gross, combined_pct=variable, value=net, tax_amount=tax,
        cash_refund=to_money(cash_refund), credit_reduction=to_money(credit_reduction),
        cash_account_id=cash_acc.id if cash_acc else None,
        rep_id=rep_id, revenue_account_id=revenue_account_id,
        external_document_number=(external_document_number or None),
        notes=(notes or None), statement1=(statement1 or None),
        statement2=(statement2 or None), statement3=(statement3 or None),
        # Defaulted here rather than in the column so a return always carries a real day — a NULL
        # would push every report that groups by day into guessing.
        return_date=return_date or date.today(),
        ledger_entry_id=None, actor_user_id=actor_user_id,
    )
    if existing is not None:
        existing.customer_id = customer_id
        existing.family = family
        existing.origin_location_kind = origin_location_kind
        existing.origin_location_id = origin_location_id
        existing.gross = gross
        existing.combined_pct = variable
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
        base_qty = to_qty(Decimal(ln.quantity) * factor)  # goods return to stock in base units
        # (030) Each line may come back into its own warehouse, same as a sale leaves from one.
        back_kind, back_loc = ((LocationKind.warehouse, ln.warehouse_id)
                               if ln.warehouse_id is not None
                               else (origin_location_kind, origin_location_id))
        stock_service.post_movement(
            db, item_id=ln.item_id, location_kind=back_kind,
            location_id=back_loc, movement_type="sale_return_in",
            direction=StockDirection.in_, quantity=base_qty, actor_user_id=actor_user_id,
            source_doc_type="sale_return", source_doc_id=ret.id,
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
            line_total=line_total, unit=ln.unit, unit_factor=factor,
            location_kind=back_kind, location_id=back_loc,
            # (030) A standalone return has no originating sale to copy a cost from, so it takes
            # the current average — the best available estimate of what is coming back in.
            unit_cost=to_money(costing_service.average_cost(db, ln.item_id) * factor),
        ))

    entry_lines = [LineInput(account_resolver.sales_revenue_account(db).id, Direction.debit, net)]
    if tax > ZERO:
        entry_lines.append(LineInput(tax_service.output_tax_account(db).id, Direction.debit,
                                     tax, statement="رد ضريبة القيمة المضافة"))
    if to_money(cash_refund) > ZERO:
        entry_lines.append(LineInput(cash_acc.id, Direction.credit, to_money(cash_refund)))
    if to_money(credit_reduction) > ZERO:
        entry_lines.append(LineInput(cust_acc.account_id, Direction.credit, to_money(credit_reduction)))
    entry = ledger_service.post_entry(
        db, entry_type="sale_return", actor_user_id=actor_user_id, lines=entry_lines,
        rep_id=ret.rep_id,
        description=f"Sales return {ret.document_number}",
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="sale.return_standalone", actor_user_id=actor_user_id,
                         entity_type="sales_return", entity_id=ret.id, after={"value": str(net)})
    hooks.emit("standalone_return_created", db, ret)
    return ret


def last_sold_price(db: Session, *, customer_id: int, item_id: int) -> dict | None:
    """The price this customer last paid for this item + a short purchase history (028). The
    "last price" is the effective per-unit price paid (line_total / quantity, i.e. after the line
    discount), which is what the return should refund by default. None if never bought."""
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
