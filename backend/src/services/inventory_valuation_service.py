"""قيمة المخزون في تاريخ — لفرع (أو للشركة كلها).

ليه ملف لوحده؟ لأن «المخزون كان بكام يوم ٣١-٣» سؤال بتسأله أكتر من شاشة: قائمة الدخل
(مخزون أول وآخر المدة في تكلفة المبيعات)، وحزمة إقفال الربع (المخزون بخط الإنتاج،
والميزانية). لو كل واحدة حسبته بطريقتها، الرقمين اللي المفروض يبقوا واحد هيختلفوا
والعميل هيسأل أنهي فيهم الصح.

**الكمية**: صافي حركات المخزون (`stock_movement`) في مخازن الفرع لحد التاريخ ده —
تاريخ الحركة الفعلي (`movement_date`)، وإلا يوم ما اتسجّلت. نفس تعريف تقرير الأرصدة
(`lib.reporting.inventory`) بس متقطوع عند تاريخ.

**التكلفة** — طريقتين، والاختيار للمحاسب:

* ``average`` (الافتراضي): متوسط سعر الشرا المرجّح **لحد التاريخ ده** من فواتير شرا
  الفرع، بعد خصم السطر وخصم المستند، وناقص المرتجع بنفس سعر دخوله — نفس معادلة
  `costing_service.average_cost` بس مقفولة على تاريخ وفرع. الصنف اللي مالوش شرا قبل
  التاريخ بياخد سعر الشرا المكتوب على الكارت، وإلا صفر ويتعلّم «من غير تكلفة».
* ``list_factor``: زي ورق جرد العميل بالظبط — «أصل اللستة» (سعر البيع على الكارت) ×
  نسبة صافي لكل فئة (البولي والمعزول ٤٠٪، الأبيض والجوان ٦٠٪ في جرد العلياء ٣٠-٦-٢٠٢٦).
  الفئة اللي مالهاش نسبة بترجع للمتوسط.

**الفئات المستبعدة**: أصناف مش بضاعة للبيع (عِدد خدمة العملاء، أدوات مكتبية، كوبونات)
بتتشال من القيمة ومن صافي المشتريات بنفس القايمة — عشان معادلة تكلفة المبيعات
(أول + مشتريات − آخر) تبقى على نفس الأصناف من الطرفين.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, and_, case, cast, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.warehouse import Warehouse

COST_BASES = ("average", "list_factor")


@dataclass
class Valuation:
    as_of: date
    branch_id: int | None
    cost_basis: str
    total: Decimal = ZERO
    #: فئة الصنف ⇒ القيمة. ده اللي بيتقارن بصفحة «قيمة المخازن» في ورق الجرد.
    by_category: dict[str, Decimal] = field(default_factory=dict)
    #: صف لكل (صنف × مخزن) رصيده مش صفر.
    rows: list[dict] = field(default_factory=list)
    #: أصناف ليها رصيد ومالهاش أي تكلفة — قيمتها صفر في الإجمالي، فلازم تبان.
    missing_cost: int = 0
    #: أصناف رصيدها بالسالب — الدفتر بيقول «خرج أكتر من اللي دخل»، والقيمة بتنقص بيها.
    negative_rows: int = 0
    excluded_value: Decimal = ZERO

    def as_dict(self, *, with_rows: bool = True) -> dict:
        out = {
            "as_of": self.as_of.isoformat(), "branch_id": self.branch_id,
            "cost_basis": self.cost_basis, "total": str(self.total),
            "by_category": {k: str(v) for k, v in sorted(
                self.by_category.items(), key=lambda kv: -kv[1])},
            "missing_cost": self.missing_cost, "negative_rows": self.negative_rows,
            "excluded_value": str(self.excluded_value),
        }
        if with_rows:
            out["rows"] = self.rows
        return out


def branch_warehouse_ids(db: Session, branch_id: int | None) -> list[int] | None:
    if branch_id is None:
        return None
    return list(db.scalars(select(Warehouse.id).where(Warehouse.branch_id == branch_id)).all())


def quantities_at(db: Session, *, branch_id: int | None,
                  as_of: date) -> dict[tuple[int, int], Decimal]:
    """(صنف، مخزن) ⇒ الرصيد آخر يوم `as_of`."""
    when = func.coalesce(StockMovement.movement_date, cast(StockMovement.created_at, Date))
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    stmt = (select(StockMovement.item_id, StockMovement.location_id, signed)
            .where(StockMovement.location_kind == LocationKind.warehouse, when <= as_of)
            .group_by(StockMovement.item_id, StockMovement.location_id))
    mine = branch_warehouse_ids(db, branch_id)
    if mine is not None:
        stmt = stmt.where(StockMovement.location_id.in_(mine or [-1]))
    out: dict[tuple[int, int], Decimal] = {}
    for item_id, wh_id, qty in db.execute(stmt).all():
        q = to_qty(qty or 0)
        if q != to_qty(0):
            out[(item_id, wh_id)] = q
    return out


def average_cost_at(db: Session, item_ids, *, as_of: date,
                    branch_id: int | None) -> dict[int, Decimal]:
    """متوسط تكلفة الوحدة الأساسية لكل صنف من الشرا لحد `as_of` — بنفس معادلة
    `costing_service.average_cost_bulk` (خصم السطر جوّه `line_total`، وخصم المستند بيتضرب،
    والمرتجع بيتشال بسعر دخوله) بس مقفولة على تاريخ وفرع.

    التاريخ مهم: متوسط «النهارده» بيقيّم مخزون ٣١-٣ بأسعار شحنات لسه ماوصلتش ساعتها.
    """
    ids = list({int(i) for i in item_ids})
    if not ids:
        return {}
    after_doc = 1 - func.coalesce(PurchaseInvoice.combined_pct, 0) / 100
    bought_stmt = (
        select(PurchaseInvoiceLine.item_id,
               func.coalesce(func.sum(
                   PurchaseInvoiceLine.quantity * PurchaseInvoiceLine.unit_factor), 0),
               func.coalesce(func.sum(PurchaseInvoiceLine.line_total * after_doc), 0))
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseInvoiceLine.invoice_id)
        .where(PurchaseInvoiceLine.item_id.in_(ids),
               func.coalesce(PurchaseInvoice.purchase_date,
                             cast(PurchaseInvoice.created_at, Date)) <= as_of)
        .group_by(PurchaseInvoiceLine.item_id)
    )
    if branch_id is not None:
        bought_stmt = bought_stmt.where(PurchaseInvoice.branch_id == branch_id)
    bought = {i: (Decimal(str(q or 0)), Decimal(str(v or 0)))
              for i, q, v in db.execute(bought_stmt).all()}

    returned_stmt = (
        select(PurchaseReturnLine.item_id,
               func.coalesce(func.sum(PurchaseReturnLine.quantity), 0),
               func.coalesce(func.sum(
                   PurchaseReturnLine.quantity * PurchaseInvoiceLine.unit_price
                   * (1 - func.coalesce(PurchaseInvoiceLine.discount_pct, 0) / 100)
                   * after_doc), 0))
        .select_from(PurchaseReturnLine)
        .join(PurchaseReturn, PurchaseReturn.id == PurchaseReturnLine.return_id)
        .join(PurchaseInvoice, PurchaseInvoice.id == PurchaseReturn.purchase_invoice_id)
        .join(PurchaseInvoiceLine, and_(
            PurchaseInvoiceLine.invoice_id == PurchaseInvoice.id,
            PurchaseInvoiceLine.item_id == PurchaseReturnLine.item_id))
        .where(PurchaseReturnLine.item_id.in_(ids), PurchaseReturn.reversed_at.is_(None),
               func.coalesce(PurchaseReturn.return_date,
                             cast(PurchaseReturn.created_at, Date)) <= as_of)
        .group_by(PurchaseReturnLine.item_id)
    )
    if branch_id is not None:
        returned_stmt = returned_stmt.where(PurchaseReturn.branch_id == branch_id)
    returned = {i: (Decimal(str(q or 0)), Decimal(str(v or 0)))
                for i, q, v in db.execute(returned_stmt).all()}

    out: dict[int, Decimal] = {}
    for item_id in ids:
        b_q, b_v = bought.get(item_id, (ZERO, ZERO))
        r_q, r_v = returned.get(item_id, (ZERO, ZERO))
        if b_q - r_q > 0:
            out[item_id] = (b_v - r_v) / (b_q - r_q)
    return out


def value_at(
    db: Session, *, branch_id: int | None, as_of: date, cost_basis: str = "average",
    exclude_categories=(), list_factors: dict[str, Decimal | float | str] | None = None,
    with_rows: bool = True,
) -> Valuation:
    """قيمة مخزون الفرع آخر يوم `as_of` — الإجمالي، وبالفئة، وصف لكل صنف × مخزن.

    دي الدالة اللي أي شاشة بتحتاج «المخزون بكام في تاريخ» بتناديها؛ قائمة الدخل
    بتناديها مرتين (أول المدة = اليوم اللي قبل البداية، وآخر المدة = النهاية).
    """
    if cost_basis not in COST_BASES:
        cost_basis = "average"
    excluded = {str(c) for c in (exclude_categories or ())}
    factors = {str(k): Decimal(str(v)) for k, v in (list_factors or {}).items()
               if v not in (None, "")}
    qtys = quantities_at(db, branch_id=branch_id, as_of=as_of)
    item_ids = {iid for iid, _ in qtys}
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(item_ids or [-1]))).all()}
    avg = average_cost_at(db, item_ids, as_of=as_of, branch_id=branch_id)
    wh_names = dict(db.execute(select(Warehouse.id, Warehouse.name)).all())

    out = Valuation(as_of=as_of, branch_id=branch_id, cost_basis=cost_basis)
    no_cost: set[int] = set()
    for (iid, wid), qty in qtys.items():
        item = items.get(iid)
        category = (item.category if item else None) or "بدون فئة"
        unit, source = None, None
        factor = factors.get(category)
        if cost_basis == "list_factor" and factor is not None and item is not None \
                and item.sale_price is not None and Decimal(str(item.sale_price)) > 0:
            unit, source = Decimal(str(item.sale_price)) * factor / 100, "list_factor"
        if unit is None and iid in avg:
            unit, source = avg[iid], "average"
        if unit is None and item is not None and item.purchase_price is not None:
            unit, source = Decimal(str(item.purchase_price)), "item_purchase_price"
        if unit is None:
            unit, source = ZERO, "none"
            no_cost.add(iid)
        value = to_money(qty * unit)
        if category in excluded:
            out.excluded_value += value
            continue
        if qty < 0:
            out.negative_rows += 1
        out.total += value
        out.by_category[category] = out.by_category.get(category, ZERO) + value
        if with_rows:
            out.rows.append({
                "item_id": iid, "item_code": item.code if item else None,
                "item_name": item.name if item else None, "category": category,
                "warehouse_id": wid, "warehouse_name": wh_names.get(wid),
                "quantity": str(qty), "unit_cost": str(to_money(unit)),
                "cost_source": source, "value": str(value),
            })
    out.total = to_money(out.total)
    out.excluded_value = to_money(out.excluded_value)
    out.missing_cost = len(no_cost)
    if with_rows:
        out.rows.sort(key=lambda r: (r["category"], r["item_name"] or "", r["warehouse_id"]))
    return out
