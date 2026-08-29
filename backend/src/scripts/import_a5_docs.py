"""المرحلة الرابعة من استيراد a5: الحركة — بيع وشرا ومردودات وتحويلات وأذون.

المراحل اللي فاتت جابت الكيانات وأول المدة. دي بتجيب اللي حصل بعد كده: ٨ شهور شغل.

    python -m src.scripts.import_a5_docs --dir C:/pgtmp/aliaa --branch العلياء --prefix AL-
    python -m src.scripts.import_a5_docs --dir C:/pgtmp/aliaa --branch العلياء --prefix AL- --yes

بيتعاد تشغيله بأمان: المستند اللي رقمه موجود بيتخطى.

---------------------------------------------------------------------------
خمس قرارات:

* **المخزون بيتحسب مش بيتنقل.** رصيد a5 الحالي رقم مخزّن عندهم؛ عندنا الرصيد مشتق من
  الحركة. فبنعيد تشغيل الحركة بالترتيب الزمني من أول المدة، والرصيد بيطلع لوحده — وكارت
  الصنف بيبقى فيه الحكاية كلها مش رقم أخير.

* **السالب مسموح هنا وبس.** `post_movement` بيرفض صرف بيوصّل الرصيد تحت الصفر، وده صح في
  الشغل اليومي. بس دي حركة حصلت خلاص، وa5 سمح بـ١٣ سطر سالب — والرفض معناه إن النقل
  يقف عند أول واحدة فيهم.

* **الكمية `n_count_unit` والقيمة `a_price`.** الأعمدة `b*` و`a*` أرصدة قبل وبعد مش
  كميات — جمعها بيدي أرقام مالهاش معنى. و`a_price` إجمالي السطر بعد الخصم مش سعر الوحدة.
  اتأكدنا: مجموع `a_price` = `emali_aftax` في الـ٦١٦٣ فاتورة كلهم.

* **`Bons` بونص عيني مش خصم نسبة.** المعادلة عندهم: إجمالي السطور − بونص + ضريبة =
  المستحق = نقدي + آجل، واتأكدت على الـ٦١٦٣. البونص بيتحوّل لنسبة عشان ده شكل الخصم عندنا.

* **رقم المستند من الـid مش من الرقم المطبوع.** فيه ١٧ فاتورة بنفس `Ord_No` — الرقم
  المطبوع مش فريد عندهم وعندنا لازم يكون. فبيتحط في «رقم المستند الخارجي»، ورقمنا بيتولّد
  من الـid المضمون فريد.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money, to_qty
from src.models.catalog import Item
from src.models.customer import Customer
from src.models.org import Branch
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.models.stock import LocationKind, StockDirection
from src.models.stock_permit import PermitKind, StockPermit, StockPermitLine
from src.models.supplier import Supplier
from src.models.transfer import (
    StockTransfer,
    StockTransferLine,
    TransferRoute,
    TransferStatus,
)
from src.models.user import User
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import _clean, _money, _read
from src.services import account_resolver, stock_service

ZERO = Decimal("0")

# نوع المستند في a5 → (اسمنا، حرف رقم المستند، جدول الرأس المصدَّر)
KIND = {
    "7": ("فواتير بيع", "S", "SALE"),
    "2": ("مردود مبيعات", "SR", "SRET"),
    "1": ("فواتير شراء", "P", "BUY"),
    "11": ("مردود مشتريات", "PR", "BRET"),
    "6": ("تحويلات", "T", None),
    "3": ("أذون إضافة", "RC", None),
    "8": ("أذون صرف", "IS", None),
}

# أعمدة السطر في الملف المصدّر
(L_TYPE, L_AZN, L_DATE, L_ORD, L_ORDBK, L_POORD, L_POBK, L_CODE, L_NAME,
 L_IN, L_OUT, L_QTY, L_PRICE, L_TOTAL, L_MEMO, L_JUST, L_COST) = range(17)

# أعمدة الرأس
(H_KIND, H_ID, H_NO, H_DATE, H_PARTY, H_REP, H_GROSS, H_BONS, H_TAX,
 H_NET, H_CASH, H_CREDIT, H_PTYPE, H_MEMO, H_USER) = range(15)


def _date(v: str) -> date | None:
    try:
        return datetime.strptime((v or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _doc_key(r: list[str]) -> str:
    """مفتاح المستند اللي السطر تابع له. التحويلات والأذون مالهاش رأس، فبتتجمّع بـAzn_id."""
    t = r[L_TYPE]
    if t == "7":
        return r[L_ORD]
    if t == "2":
        return r[L_ORDBK]
    if t == "1":
        return r[L_POORD]
    if t == "11":
        return r[L_POBK]
    return r[L_AZN]


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    """البونص عندهم مبلغ والخصم عندنا نسبة. صفر على صفر = صفر مش قسمة على صفر."""
    if whole <= ZERO or part <= ZERO:
        return ZERO
    return to_money(part * 100 / whole)


class Ctx:
    """كل اللي السكربت محتاجه من القاعدة، متجاب مرة واحدة بدل استعلام لكل سطر."""

    def __init__(self, db, branch: Branch, prefix: str) -> None:
        self.db = db
        self.branch = branch
        self.prefix = prefix
        self.admin = db.scalars(select(User).order_by(User.id)).first()
        self.treasury = account_resolver.treasury_account(db, branch_id=branch.id)

        items = db.scalars(select(Item)).all()
        mine = [i for i in items if not prefix or (i.code or "").startswith(prefix)]
        self.item_by_code = {i.code: i for i in mine if i.code}
        self.item_by_name = {i.name: i for i in mine}

        self.wh = {w.name: w for w in db.scalars(
            select(Warehouse).where(Warehouse.branch_id == branch.id)).all()}
        self.cust = {c.name: c for c in db.scalars(
            select(Customer).where(Customer.branch_id == branch.id)).all()}
        self.supp = {s.name: s for s in db.scalars(select(Supplier)).all()}

        role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        self.rep: dict[str, User] = {}
        if role is not None:
            for u in db.scalars(select(User).where(User.role_id == role.id,
                                                   User.branch_id == branch.id)).all():
                if (u.full_name or "").strip():
                    self.rep[u.full_name.strip()] = u

        # أرقام المستندات الموجودة — عشان الإعادة تتخطى بدل ما تقع على قيد التفرّد.
        self.taken: set[str] = set()
        for model in (SalesInvoice, SalesReturn, PurchaseInvoice, PurchaseReturn,
                      StockTransfer, StockPermit):
            self.taken |= {n for (n,) in db.execute(select(model.document_number)).all()}

        self.skipped: list[str] = []
        self.made: dict[str, int] = defaultdict(int)

    def number(self, tag: str, a5_id: str) -> str:
        return f"{self.prefix}{tag}{a5_id}"

    def item(self, r: list[str]) -> Item | None:
        return (self.item_by_code.get(f"{self.prefix}{_clean(r[L_CODE])}")
                or self.item_by_name.get(_clean(r[L_NAME])))

    def store(self, name: str) -> Warehouse | None:
        return self.wh.get(_clean(name))

    def move(self, item_id: int, wh_id: int, kind: str, direction: StockDirection,
             qty: Decimal, doc_type: str, doc_id: int):
        return stock_service.post_movement(
            self.db, item_id=item_id, location_kind=LocationKind.warehouse,
            location_id=wh_id, movement_type=kind, direction=direction,
            quantity=qty, source_doc_type=doc_type, source_doc_id=doc_id,
            actor_user_id=self.admin.id, allow_negative=True)


def _lines_of(c: Ctx, rows: list[list[str]], store_col: int, label: str):
    """يحوّل سطور a5 لصفوف جاهزة: (الصنف، المخزن، الكمية، السعر، الإجمالي، التكلفة)."""
    out = []
    for r in rows:
        it = c.item(r)
        if it is None:
            c.skipped.append(f"{label}: صنف مش موجود «{_clean(r[L_NAME])}»")
            continue
        wh = c.store(r[store_col])
        if wh is None:
            c.skipped.append(f"{label}: مخزن مش موجود «{_clean(r[store_col])}»")
            continue
        qty = to_qty(_money(r[L_QTY]))
        if qty <= ZERO:
            continue
        out.append((it, wh, qty, to_money(_money(r[L_PRICE])),
                    to_money(_money(r[L_TOTAL])), to_money(_money(r[L_COST]))))
    return out


def _sale(c: Ctx, h: list[str], rows: list[list[str]]) -> None:
    num = c.number("S", h[H_ID])
    if num in c.taken:
        return
    cust = c.cust.get(_clean(h[H_PARTY]))
    if cust is None:
        c.skipped.append(f"فاتورة بيع: عميل مش موجود «{_clean(h[H_PARTY])}»")
        return
    ls = _lines_of(c, rows, L_OUT, "فاتورة بيع")
    if not ls:
        return
    gross = to_money(_money(h[H_GROSS]))
    bons = to_money(_money(h[H_BONS]))
    pct = _pct(bons, gross)
    rep = c.rep.get(_clean(h[H_REP]))
    inv = SalesInvoice(
        branch_id=c.branch.id, document_number=num,
        external_document_number=str(h[H_NO])[:40] or None,
        customer_id=cust.id, rep_id=rep.id if rep else cust.rep_id,
        origin_location_kind=LocationKind.warehouse, origin_location_id=ls[0][1].id,
        invoice_date=_date(h[H_DATE]), notes=_clean(h[H_MEMO])[:500] or None,
        gross=gross, fixed_discount_pct=ZERO, variable_discount_pct=pct,
        combined_pct=pct, net=to_money(gross - bons),
        tax_amount=to_money(_money(h[H_TAX])),
        cash_amount=to_money(_money(h[H_CASH])),
        credit_amount=to_money(_money(h[H_CREDIT])),
        cash_account_id=c.treasury.id, actor_user_id=c.admin.id)
    c.db.add(inv)
    c.db.flush()
    for it, wh, qty, price, total, cost in ls:
        c.db.add(SalesInvoiceLine(
            invoice_id=inv.id, item_id=it.id, quantity=qty, unit_price=price,
            line_total=total, discount_pct=ZERO,
            location_kind=LocationKind.warehouse, location_id=wh.id,
            unit_cost=cost or None))
        c.move(it.id, wh.id, "sale", StockDirection.out, qty, "sales_invoice", inv.id)
    c.taken.add(num)
    c.made["فواتير بيع"] += 1


def _sale_return(c: Ctx, h: list[str], rows: list[list[str]]) -> None:
    num = c.number("SR", h[H_ID])
    if num in c.taken:
        return
    cust = c.cust.get(_clean(h[H_PARTY]))
    ls = _lines_of(c, rows, L_IN, "مردود بيع")
    if not ls:
        return
    gross = to_money(_money(h[H_GROSS]))
    bons = to_money(_money(h[H_BONS]))
    ret = SalesReturn(
        branch_id=c.branch.id, document_number=num,
        external_document_number=str(h[H_NO])[:40] or None,
        customer_id=cust.id if cust else None,
        origin_location_kind=LocationKind.warehouse, origin_location_id=ls[0][1].id,
        return_date=_date(h[H_DATE]), notes=_clean(h[H_MEMO])[:500] or None,
        gross=gross, combined_pct=_pct(bons, gross), value=to_money(gross - bons),
        tax_amount=to_money(_money(h[H_TAX])),
        cash_refund=to_money(_money(h[H_CASH])),
        credit_reduction=to_money(_money(h[H_CREDIT])),
        cash_account_id=c.treasury.id, actor_user_id=c.admin.id)
    c.db.add(ret)
    c.db.flush()
    for it, wh, qty, price, total, cost in ls:
        c.db.add(SalesReturnLine(
            return_id=ret.id, item_id=it.id, quantity=qty, unit_price=price,
            line_total=total, location_kind=LocationKind.warehouse, location_id=wh.id,
            unit_cost=cost or None))
        c.move(it.id, wh.id, "sales_return", StockDirection.in_, qty,
               "sales_return", ret.id)
    c.taken.add(num)
    c.made["مردود مبيعات"] += 1


def _purchase(c: Ctx, h: list[str], rows: list[list[str]]) -> None:
    num = c.number("P", h[H_ID])
    if num in c.taken:
        return
    supp = c.supp.get(_clean(h[H_PARTY]))
    if supp is None:
        c.skipped.append(f"فاتورة شراء: مورد مش موجود «{_clean(h[H_PARTY])}»")
        return
    ls = _lines_of(c, rows, L_IN, "فاتورة شراء")
    if not ls:
        return
    gross = to_money(_money(h[H_GROSS]))
    bons = to_money(_money(h[H_BONS]))
    tax = to_money(_money(h[H_TAX]))
    pct = _pct(bons, gross)
    inv = PurchaseInvoice(
        branch_id=c.branch.id, document_number=num,
        external_document_number=str(h[H_NO])[:40] or None,
        supplier_id=supp.id, location_kind=LocationKind.warehouse,
        location_id=ls[0][1].id, purchase_date=_date(h[H_DATE]),
        notes=_clean(h[H_MEMO])[:500] or None,
        gross=gross, fixed_discount_pct=ZERO, variable_discount_pct=pct,
        combined_pct=pct, net=to_money(gross - bons), tax_amount=tax,
        total=to_money(gross - bons + tax),
        cash_amount=to_money(_money(h[H_CASH])),
        credit_amount=to_money(_money(h[H_CREDIT])),
        actor_user_id=c.admin.id)
    c.db.add(inv)
    c.db.flush()
    for it, wh, qty, price, total, _cost in ls:
        c.db.add(PurchaseInvoiceLine(
            invoice_id=inv.id, item_id=it.id, quantity=qty, unit_price=price,
            line_total=total, line_location_kind=LocationKind.warehouse,
            line_location_id=wh.id))
        c.move(it.id, wh.id, "purchase", StockDirection.in_, qty,
               "purchase_invoice", inv.id)
    c.taken.add(num)
    c.made["فواتير شراء"] += 1


def _purchase_return(c: Ctx, h: list[str], rows: list[list[str]]) -> None:
    num = c.number("PR", h[H_ID])
    if num in c.taken:
        return
    supp = c.supp.get(_clean(h[H_PARTY]))
    ls = _lines_of(c, rows, L_OUT, "مردود شراء")
    if not ls:
        return
    gross = to_money(_money(h[H_GROSS]))
    bons = to_money(_money(h[H_BONS]))
    ret = PurchaseReturn(
        branch_id=c.branch.id, document_number=num,
        external_document_number=str(h[H_NO])[:40] or None,
        supplier_id=supp.id if supp else None,
        origin_location_kind=LocationKind.warehouse, origin_location_id=ls[0][1].id,
        return_date=_date(h[H_DATE]), notes=_clean(h[H_MEMO])[:500] or None,
        # مردود الشرا عندنا مافيهوش نقدي/آجل: قيمته بتتقيّد على المورد وخلاص. اللي في
        # a5 مقسوم نقدي وآجل بيروح في «بيان» عشان مايضيعش.
        gross=gross, variable_discount_pct=_pct(bons, gross),
        combined_pct=_pct(bons, gross), value=to_money(gross - bons),
        statement1=f"نقدي {_money(h[H_CASH])} · آجل {_money(h[H_CREDIT])}"[:200],
        actor_user_id=c.admin.id)
    c.db.add(ret)
    c.db.flush()
    for it, wh, qty, price, total, _cost in ls:
        c.db.add(PurchaseReturnLine(
            return_id=ret.id, item_id=it.id, quantity=qty, unit_price=price,
            line_total=total))
        c.move(it.id, wh.id, "purchase_return", StockDirection.out, qty,
               "purchase_return", ret.id)
    c.taken.add(num)
    c.made["مردود مشتريات"] += 1


def _transfer(c: Ctx, azn: str, rows: list[list[str]]) -> None:
    """التحويل عندهم سطر شايل المخزنين. عندنا مستند بمصدر ووجهة وسطور."""
    num = c.number("T", azn)
    if num in c.taken:
        return
    src = c.store(rows[0][L_OUT])
    dst = c.store(rows[0][L_IN])
    if src is None or dst is None:
        c.skipped.append(f"تحويل: مخزن مش موجود «{_clean(rows[0][L_OUT])}»"
                         f" → «{_clean(rows[0][L_IN])}»")
        return
    ls = _lines_of(c, rows, L_OUT, "تحويل")
    if not ls:
        return
    when = _date(rows[0][L_DATE])
    tr = StockTransfer(
        branch_id=c.branch.id, document_number=num,
        item_id=ls[0][0].id, quantity=ls[0][2],
        route=TransferRoute.central_to_branch,
        source_location_kind=LocationKind.warehouse, source_location_id=src.id,
        dest_location_kind=LocationKind.warehouse, dest_location_id=dst.id,
        status=TransferStatus.approved, transfer_date=when,
        initiated_by=c.admin.id, approved_by=c.admin.id,
        approved_at=datetime.combine(when, datetime.min.time()) if when else None)
    c.db.add(tr)
    c.db.flush()
    for it, _wh, qty, _price, _total, _cost in ls:
        out = c.move(it.id, src.id, "transfer_out", StockDirection.out, qty,
                     "stock_transfer", tr.id)
        inn = c.move(it.id, dst.id, "transfer_in", StockDirection.in_, qty,
                     "stock_transfer", tr.id)
        c.db.add(StockTransferLine(transfer_id=tr.id, item_id=it.id, quantity=qty,
                                   out_movement_id=out.id, in_movement_id=inn.id))
    c.taken.add(num)
    c.made["تحويلات"] += 1


def _permit(c: Ctx, azn: str, rows: list[list[str]], *, receipt: bool) -> None:
    tag, kind, col, direction, label = (
        ("RC", PermitKind.receipt, L_IN, StockDirection.in_, "أذون إضافة") if receipt
        else ("IS", PermitKind.issue, L_OUT, StockDirection.out, "أذون صرف"))
    num = c.number(tag, azn)
    if num in c.taken:
        return
    ls = _lines_of(c, rows, col, label)
    if not ls:
        return
    permit = StockPermit(
        document_number=num, kind=kind, warehouse_id=ls[0][1].id,
        permit_date=_date(rows[0][L_DATE]),
        reason=_clean(rows[0][L_MEMO])[:240] or None,
        total_cost=to_money(sum((x[4] for x in ls), ZERO)),
        actor_user_id=c.admin.id)
    c.db.add(permit)
    c.db.flush()
    for it, wh, qty, _price, total, _cost in ls:
        mv = c.move(it.id, wh.id, "permit", direction, qty, "stock_permit", permit.id)
        c.db.add(StockPermitLine(permit_id=permit.id, item_id=it.id, quantity=qty,
                                 line_cost=total, stock_movement_id=mv.id))
    c.taken.add(num)
    c.made[label] += 1


def _report(c: Ctx) -> None:
    print(f"\n{'الكيان':<18}{'اتعمل':>8}")
    print("-" * 28)
    for k, v in sorted(c.made.items()):
        print(f"{k:<18}{v:>8}")
    if not c.skipped:
        return
    # الأسباب بتتجمّع: «صنف مش موجود ×٤٠٠» أنفع من ٤٠٠ سطر بنفس الكلام.
    seen: dict[str, int] = defaultdict(int)
    for s in c.skipped:
        seen[s] += 1
    print(f"\nاتخطّى {len(c.skipped)} سطر/مستند، {len(seen)} سبب:")
    for s, n in sorted(seen.items(), key=lambda x: -x[1])[:20]:
        print(f"   {n:>6} × {s}")
    if len(seen) > 20:
        print(f"    … و{len(seen) - 20} سبب تاني")


def run(folder: str, *, execute: bool, branch_name: str = "", prefix: str = "") -> None:
    hdrs = _read(os.path.join(folder, "a5_hdr.tsv"))
    lines = [r for r in _read(os.path.join(folder, "a5_lines.tsv"))
             if len(r) >= 17 and r[L_TYPE] in KIND]

    docs: dict[tuple[str, str], list[list[str]]] = defaultdict(list)
    for r in lines:
        docs[(r[L_TYPE], _doc_key(r))].append(r)

    print("المصدر:")
    for t, (label, _tag, _tbl) in KIND.items():
        n = sum(1 for k in docs if k[0] == t)
        rows = sum(len(v) for k, v in docs.items() if k[0] == t)
        print(f"   {label:<16}{n:>7} مستند {rows:>8} سطر")
    print(f"   {'رؤوس':<16}{len(hdrs):>7}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit("مافيش فرع اسمه " + branch_name)
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        print("الفرع المستهدف: " + branch.name
              + ((" · البادئة: " + prefix) if prefix else "") + "\n")

        c = Ctx(db, branch, prefix)
        hdr = {(r[H_KIND], r[H_ID]): r for r in hdrs if len(r) >= 15}

        # الترتيب الزمني هو كل الحكاية: الرصيد مشتق من الحركة، فالحركة لازم تتعاد بترتيبها.
        ordered = sorted(docs.items(),
                         key=lambda kv: (kv[1][0][L_DATE], int(kv[1][0][L_JUST] or 0)))
        for done, ((t, key), rows) in enumerate(ordered, 1):
            label, _tag, table = KIND[t]
            if table is not None:
                h = hdr.get((table, key))
                if h is None:
                    c.skipped.append(f"{label}: مستند مالوش رأس")
                elif t == "7":
                    _sale(c, h, rows)
                elif t == "2":
                    _sale_return(c, h, rows)
                elif t == "1":
                    _purchase(c, h, rows)
                else:
                    _purchase_return(c, h, rows)
            elif t == "6":
                _transfer(c, key, rows)
            else:
                _permit(c, key, rows, receipt=(t == "3"))
            if done % 1000 == 0:
                print(f"   … {done}/{len(ordered)}")

        db.commit()
        _report(c)
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    target = args[args.index("--branch") + 1] if "--branch" in args else ""
    pref = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    run(folder, execute="--yes" in args, branch_name=target, prefix=pref)
