"""Purchase service (T022–T023). FR-010–012.

Purchase: raw materials in (stock) + one balanced ledger entry (debit purchases_expense; credit
cash-location + supplier_payable). Return: partial, money reversed proportionally to the original
cash/credit split (research R9).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.ledger import Account, Direction
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.models.supplier import Supplier, SupplierAccount
from src.services import (
    account_resolver,
    audit_service,
    ledger_service,
    sales_service,
    stock_service,
    tax_service,
    uom_service,
)
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
    # خصم السطر. None = مفيش خصم متفق عليه — مش صفر.
    discount_pct: Decimal | None = None


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
    # خصم الفاتورة والضريبة — نفس ترتيب البيع بالظبط.
    variable_discount_pct: Decimal = ZERO,
) -> PurchaseInvoice:
    if not lines:
        raise PurchaseError("فاتورة الشراء لازم يكون فيها صنف واحد على الأقل.")
    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise PurchaseError("المورد مش موجود.")
    supplier_acc = db.scalar(
        select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id)
    )

    fixed = sales_service.fixed_discount_pct(db)
    variable = Decimal(variable_discount_pct)
    combined = fixed + variable
    if combined >= Decimal("100") or variable < ZERO:
        raise PurchaseError("الخصم المجمّع لازم يكون أقل من ١٠٠٪ والخصم المتغيّر مايكونش بالسالب.")

    gross = ZERO
    built: list[tuple[PurchaseLine, Decimal, Decimal, Decimal | None]] = []
    for ln in lines:
        item = db.get(Item, ln.item_id)
        if item is None:
            raise PurchaseError("الصنف المشترى مش موجود.")
        # Purchases accept any stocked item — raw materials AND finished products (resale/trading).
        try:
            factor = uom_service.resolve_factor(db, item, ln.unit)  # (008)
        except UomError as exc:
            raise PurchaseError(str(exc)) from exc
        line_disc = Decimal(ln.discount_pct) if getattr(ln, "discount_pct", None) is not None             else ZERO
        if line_disc < ZERO or line_disc >= Decimal("100"):
            raise PurchaseError("خصم السطر لازم يكون من صفر لأقل من ١٠٠٪.")
        line_before = Decimal(ln.quantity) * Decimal(ln.unit_price)
        line_total = to_money(line_before * (Decimal("1") - line_disc / Decimal("100")))
        gross += line_total
        built.append((ln, line_total, factor, line_disc))
    gross = to_money(gross)
    # The invoice discount comes off the summed lines ONCE — applying it per line instead gives
    # different money on the same numbers, and the sale settles it this way.
    net = sales_service.compute_net(gross, combined)
    tax = tax_service.tax_on(net, tax_service.vat_rate(db))
    total = to_money(net + tax)
    if to_money(cash_amount) + to_money(credit_amount) != total:
        raise PurchaseError("النقدي + الآجل لازم يساوي إجمالي فاتورة الشراء.")

    # Stock in (raw materials) — one movement per line.
    invoice = PurchaseInvoice(
        document_number=_doc_number(db, PurchaseInvoice, "PINV"),
        supplier_id=supplier_id, location_kind=location_kind, location_id=location_id,
        gross=gross, fixed_discount_pct=fixed, variable_discount_pct=variable,
        combined_pct=combined, net=net, tax_amount=tax,
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
    for ln, line_total, factor, line_disc in built:
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
                                discount_pct=ln.discount_pct, unit=ln.unit, unit_factor=factor,
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
    """اترجّع كام من كل صنف على الفاتورة دي — **من غير المردودات المعكوسة**.

    المردود المعكوس بضاعته رجعت المخزن وقيده اتعكس، فعدّه هنا كان هيقفل الكمية على مردود
    مالوش أثر: «اتشرى ١٠ واترجّع ١٠» والعشرة دول رجعوا تاني — فتحاول ترجّع وتترفض من غير
    سبب باين.
    """
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


def reverse_purchase_return(
    db: Session,
    *,
    return_id: int,
    actor_user_id: int,
) -> PurchaseReturn:
    """عكس مردود شراء مرحّل — البضاعة ترجع المخزن واللي على الشركة يرجع زي ما كان.

    المردود المرحّل ماينفعش يتعدّل في مكانه، بنفس السبب اللي في الفاتورة: البضاعة اتحركت
    والقيد اتكتب، والدفتر مابيتمحاش. فالتعديل = عكس كامل وكتابة من جديد.

    العكس بيعمل حاجتين، والاتنين **إضافة** مش مسح:

    * حركة مخزن داخلة لكل سطر، على نفس المخزن اللي خرج منه. `purchase_return_out` طلّع البضاعة
      من مخزن بعينه — لو رجعت لمخزن تاني يبقى الرصيدين الاتنين غلط.
    * قيد مضاد عن طريق `ledger_service.reverse_entry` — مش قيد جديد مكتوب بالإيد. لو اتكتب
      بالإيد هيبقى فيه نسختين من نفس الحسبة، وأول ما حسبة المردود تتغيّر تفضل واحدة منهم قديمة.

    والصف بيفضل موجود بعلامة، مش بيتمسح: رقم المستند اتصرف والقيد المضاد بيشاور عليه.
    """
    ret = db.get(PurchaseReturn, return_id)
    if ret is None:
        raise PurchaseError("المردود مش موجود.")
    if ret.reversed_at is not None:
        raise PurchaseError("المردود ده اتعكس قبل كده.")

    inv = db.get(PurchaseInvoice, ret.purchase_invoice_id) if ret.purchase_invoice_id else None
    if ret.purchase_invoice_id and inv is None:
        raise PurchaseError("فاتورة الشراء بتاعت المردود مش موجودة.")

    # البضاعة بترجع للمكان اللي خرجت منه.
    #
    # المردود المربوط بفاتورة خرج من مخازن سطورها — كل سطر من مخزنه. والمستقل خرج من مخزن
    # واحد مكتوب عليه. الحالتين بيرجّعوا لنفس المكان بالظبط: رجوع لمخزن تاني بيخلّي الرصيدين
    # الاتنين غلط.
    received_into = {
        ln.item_id: (ln.line_location_kind or inv.location_kind,
                     ln.line_location_id if ln.line_location_id is not None else inv.location_id)
        for ln in inv.lines
    } if inv else {}
    factors = {ln.item_id: to_qty(ln.unit_factor) for ln in inv.lines} if inv else {}
    fallback = ((inv.location_kind, inv.location_id) if inv
                else (ret.origin_location_kind, ret.origin_location_id))
    if fallback[0] is None or fallback[1] is None:
        raise PurchaseError("المردود ده مالوش مخزن مسجّل — مايتعكسش.")

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
) -> PurchaseReturn:
    """مردود شرا مستقل — **نسخة من فاتورة الشرا بالعكس**.

    نفس المستند بالظبط: نفس الترويسة (تاريخ، فرع، حساب، رقم مستند، مورد، ملاحظات، تلات بيانات)،
    ونفس السطر (مخزن، وحدة، كمية، سعر، خصم سطر)، ونفس سلّم الأرقام (قبل الخصم → خصم المستند →
    الصافي). اللي بالعكس حاجتين بس، وهما اللي بيخلّوه مردود:

    * **البضاعة بتخرج** من المخزن بدل ما تدخله.
    * **اللي على الشركة للمورد بينقص** بدل ما يزيد.

    الشركة بترجّع بضاعة لمورد من غير ما تكون عارفة أنهي فاتورة جابتها، فمفيش فاتورة أصل تتقرا
    منها الأسعار: السعر بيتكتب على السطر زي ما بيتكتب على الفاتورة بالظبط.

    والحد الوحيد على الكمية هو الرصيد — `stock_service` بيرفض اللي مش موجود.
    """
    if not lines:
        raise PurchaseError("المردود لازم يكون فيه صنف واحد على الأقل.")
    variable = Decimal(variable_discount_pct or 0)
    if variable < ZERO or variable >= Decimal("100"):
        raise PurchaseError("خصم المستند لازم يكون من صفر لأقل من ١٠٠٪.")

    supplier = db.get(Supplier, supplier_id)
    if supplier is None:
        raise PurchaseError("المورد مش موجود.")

    gross = ZERO
    built: list[dict] = []
    for ln in lines:
        item = db.get(Item, ln["item_id"])
        if item is None:
            raise PurchaseError("الصنف مش موجود.")
        qty = Decimal(ln["quantity"])
        if qty <= ZERO:
            raise PurchaseError("الكمية لازم تكون أكبر من صفر.")
        unit = ln.get("unit")
        # نفس الدالة اللي الفاتورة بتستعملها — معامل الوحدة لازم يكون واحد في الاتنين.
        factor = uom_service.resolve_factor(db, item, unit) if unit else Decimal("1")
        price = to_money(ln.get("unit_price") or 0)
        disc = ln.get("discount_pct")
        disc = Decimal(disc) if disc is not None else None
        before = to_money(qty * price)
        line_total = to_money(before * (Decimal("1") - (disc or ZERO) / Decimal("100")))
        gross += line_total
        built.append({
            "item_id": item.id, "quantity": qty, "unit": unit, "factor": to_qty(factor),
            "unit_price": price, "discount_pct": disc, "line_total": line_total,
            "location_kind": ln.get("location_kind") or origin_location_kind,
            "location_id": ln.get("location_id") or origin_location_id,
        })

    gross = to_money(gross)
    value = to_money(gross * (Decimal("1") - variable / Decimal("100")))

    ret = PurchaseReturn(
        document_number=_doc_number(db, PurchaseReturn, "PRET"),
        purchase_invoice_id=None,
        supplier_id=supplier_id,
        origin_location_kind=origin_location_kind,
        origin_location_id=origin_location_id,
        gross=gross, variable_discount_pct=variable, combined_pct=variable, value=value,
        ledger_entry_id=None, actor_user_id=actor_user_id,
        return_date=return_date or date.today(), notes=notes,
        expense_account_id=expense_account_id,
        external_document_number=external_document_number,
        statement1=statement1, statement2=statement2, statement3=statement3,
    )
    db.add(ret)
    db.flush()

    for b in built:
        stock_service.post_movement(
            db, item_id=b["item_id"], location_kind=b["location_kind"],
            location_id=b["location_id"], movement_type="purchase_return_out",
            direction=StockDirection.out, quantity=to_qty(b["quantity"] * b["factor"]),
            actor_user_id=actor_user_id, source_doc_type="purchase_return",
            source_doc_id=ret.id,
        )
        ret.lines.append(PurchaseReturnLine(
            item_id=b["item_id"], quantity=b["quantity"], unit_price=b["unit_price"],
            discount_pct=b["discount_pct"], unit=b["unit"], unit_factor=b["factor"],
            line_location_kind=b["location_kind"], line_location_id=b["location_id"],
            line_total=b["line_total"]))

    # القيد: حساب المشتريات دائن بالقيمة، وحساب المورد مدين — يعني اللي على الشركة له بينقص.
    #
    # مفيش استرداد نقدي على المستند: المردود المستقل مالوش فاتورة يعرف منها اتدفع كام نقدي،
    # والفلوس الراجعة نقداً بتتسجّل بسند صرف لما تحصل فعلاً.
    expense_acc = (db.get(Account, expense_account_id) if expense_account_id
                   else account_resolver.purchases_expense_account(db))
    if expense_acc is None:
        raise PurchaseError("حساب المشتريات مش موجود.")
    supplier_acc = db.scalar(
        select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id)
    )
    if supplier_acc is None:
        raise PurchaseError("المورد ده مالوش حساب.")

    entry = ledger_service.post_entry(
        db, entry_type="purchase_return", actor_user_id=actor_user_id,
        lines=[
            LineInput(expense_acc.id, Direction.credit, value),
            LineInput(supplier_acc.account_id, Direction.debit, value),
        ],
        description=f"Standalone purchase return {ret.document_number}",
    )
    ret.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="purchase.return.standalone", actor_user_id=actor_user_id,
                         entity_type="purchase_return", entity_id=ret.id,
                         after={"value": str(value), "supplier_id": supplier_id})
    return ret
