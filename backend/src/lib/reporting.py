"""Reporting engine — isolated, reusable report calculators (014-production-reporting).

Library-First: each report is a function `(session, **params) -> dict` with the query + aggregation
logic in one place, reused by the `/reports/*` API and CSV export. Date bucketing (week/month/year)
is done in Python so it is DB-agnostic (identical on SQLite and Postgres). Amounts use Decimal.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money, to_qty
from src.models.catalog import Item
from src.models.manufacturing import ManufacturingOrder, ManufacturingOrderConsumption
from src.models.sales import SalesInvoice
from src.models.stock import LocationKind, StockDirection, StockDoc, StockMovement
from src.models.wastage import WastageDocument


# --- helpers ---------------------------------------------------------------
def _as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.fromisoformat(str(value)[:19]).date()


def bucket_key(when: datetime | date, period: str) -> str:
    """Group a timestamp into a period bucket. period ∈ {week, month, year}."""
    d = _as_date(when)
    if period == "year":
        return f"{d.year:04d}"
    if period == "week":
        iso = d.isocalendar()
        return f"{iso[0]:04d}-W{iso[1]:02d}"
    return f"{d.year:04d}-{d.month:02d}"  # month (default)


def _in_range(when, date_from, date_to) -> bool:
    d = _as_date(when)
    if date_from and d < _as_date(date_from):
        return False
    if date_to and d > _as_date(date_to):
        return False
    return True


def branch_warehouse_ids(db: Session, branch_id: int | None) -> set[int] | None:
    """مخازن الفرع — أو `None` لما مافيش حصر.

    تقارير المخزون بتتجمّع على (صنف × مخزن)، فالفرع بيتحدّد من مخازنه مش من عمود
    على الحركة: المخزن هو اللي بيخصّ فرع، والحركة بتحصل جوّاه.
    """
    if branch_id is None:
        return None
    from src.models.warehouse import Warehouse

    return {w.id for w in db.scalars(
        select(Warehouse).where(Warehouse.branch_id == branch_id)).all()}


def _item_names(db: Session) -> dict[int, str]:
    return {i.id: i.name for i in db.scalars(select(Item)).all()}


# --- reports ---------------------------------------------------------------
def _op_batches(db: Session, product_id: int | None):
    """الإنتاج اللي اتسجّل **عمليات** مش أوامر — مجمّع في دفعات زي ما حصل.

    **مش كل إنتاج بيجي من أمر تصنيع.** النقل من a5 بيسجّل `ManufacturingOp` لكل سطر
    لأن أمر a5 الواحد بيطلّع كذا منتج وأمرنا منتج واحد؛ تفصيله كان هيتطلّب توزيع
    الخامات على المنتجات بالتخمين. فالمخزون بيطلع مظبوط، وده التقرير اللي كان
    بيشوف الأوامر وحدها فبيطلع **فاضي** رغم إن ٣٬٨٠٤ عملية إنتاج واستهلاك متسجّلة.

    **والدفعة بتتلمّ من رقم المستند.** `import_a5_manufacturing` بيكتب
    `<بادئة>MFG-<رقم أمر a5>-<تسلسل>`، فالجزء اللي قبل آخر شرطة هو أمر التشغيل
    الأصلي. ده اتفاق مكتوب في المستورد ومقروء هنا — ولو اتغيّر هناك لازم يتغيّر هنا.

    والتاريخ بييجي من حركة المخزون (`movement_date`) مش من وقت كتابة الصف: النقل
    كتب شغل سنة في يوم واحد، والترتيب بوقت الكتابة بيحطهم كلهم في بُكيت واحد.
    """
    from src.models.manufacturing import ManufactureOpType, ManufacturingOp

    stmt = (select(ManufacturingOp, StockMovement.movement_date, StockMovement.created_at)
            .join(StockMovement, StockMovement.id == ManufacturingOp.stock_movement_id)
            .where(ManufacturingOp.reverses_op_id.is_(None)))
    batches: dict[str, dict] = {}
    for op, mv_date, mv_created in db.execute(stmt).all():
        num = op.document_number or ""
        ref = num.rsplit("-", 1)[0] if "-" in num else num
        b = batches.setdefault(ref, {
            "document_number": ref, "when": mv_date or (mv_created.date() if mv_created else None),
            "produced": ZERO, "consumed": ZERO, "product_id": None})
        if op.op_type == ManufactureOpType.produce:
            b["produced"] += to_qty(op.quantity)
            if b["product_id"] is None:
                b["product_id"] = op.item_id
        else:
            b["consumed"] += to_qty(op.quantity)
    if product_id is not None:
        batches = {k: v for k, v in batches.items() if v["product_id"] == product_id}
    return list(batches.values())


def production_consumption(db: Session, *, date_from=None, date_to=None, period="month",
                           product_id: int | None = None) -> dict:
    """Actual production vs materials pulled, plus cost breakdown, bucketed by period."""
    names = _item_names(db)
    stmt = select(ManufacturingOrder).where(ManufacturingOrder.reverses_order_id.is_(None))
    if product_id is not None:
        stmt = stmt.where(ManufacturingOrder.product_id == product_id)
    rows, buckets = [], {}
    for o in db.scalars(stmt.order_by(ManufacturingOrder.id)).all():
        # **تاريخ الإنتاج قبل وقت الكتابة.** الأمر المستورد اتكتب النهارده وإنتاجه
        # حصل من شهور؛ الترتيب بـ`created_at` بيحط سنة شغل في بُكيت واحد.
        when = o.production_date or o.created_at
        if not _in_range(when, date_from, date_to):
            continue
        consumed = to_qty(sum((to_qty(c.quantity) for c in o.consumptions), ZERO))
        rows.append({
            "id": o.id, "document_number": o.document_number,
            "product_id": o.product_id, "product_name": names.get(o.product_id, ""),
            "produced_quantity": str(to_qty(o.quantity)),
            "consumed_quantity": str(consumed),
            "material_cost": str(to_money(o.material_cost)),
            "resource_cost": str(to_money(o.resource_cost)),
            "total_cost": str(to_money(o.total_cost)),
            "created_at": str(when),
        })
        b = buckets.setdefault(bucket_key(when, period),
                               {"produced": ZERO, "consumed": ZERO, "total_cost": ZERO})
        b["produced"] += to_qty(o.quantity)
        b["consumed"] += consumed
        b["total_cost"] += to_money(o.total_cost)

    # الإنتاج المسجّل عمليات — نفس الصفوف بنفس الشكل، بلا تكلفة لأن العملية
    # مابتحملش تكلفة (الأمر هو اللي بيحسبها).
    for batch in _op_batches(db, product_id):
        when = batch["when"]
        if when is None or not _in_range(when, date_from, date_to):
            continue
        rows.append({
            "id": None, "document_number": batch["document_number"],
            "product_id": batch["product_id"],
            "product_name": names.get(batch["product_id"], ""),
            "produced_quantity": str(to_qty(batch["produced"])),
            "consumed_quantity": str(to_qty(batch["consumed"])),
            "material_cost": "0.00", "resource_cost": "0.00", "total_cost": "0.00",
            "created_at": str(when),
        })
        b = buckets.setdefault(bucket_key(when, period),
                               {"produced": ZERO, "consumed": ZERO, "total_cost": ZERO})
        b["produced"] += to_qty(batch["produced"])
        b["consumed"] += to_qty(batch["consumed"])
    rows.sort(key=lambda r: r["created_at"])
    return {
        "rows": rows,
        "by_period": [{"period": k, "produced_quantity": str(to_qty(v["produced"])),
                       "consumed_quantity": str(to_qty(v["consumed"])),
                       "total_cost": str(to_money(v["total_cost"]))}
                      for k, v in sorted(buckets.items())],
    }


def inventory(db: Session, *, warehouse_id: int | None = None, item_id: int | None = None,
              branch_id: int | None = None) -> dict:
    """Current on-hand balance and value per (item × warehouse)."""
    names = _item_names(db)
    prices = {i.id: (to_money(i.purchase_price) if i.purchase_price is not None else ZERO)
              for i in db.scalars(select(Item)).all()}
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    stmt = (select(StockMovement.item_id, StockMovement.location_id, signed)
            .where(StockMovement.location_kind == LocationKind.warehouse)
            .group_by(StockMovement.item_id, StockMovement.location_id))
    mine = branch_warehouse_ids(db, branch_id)
    if mine is not None:
        stmt = stmt.where(StockMovement.location_id.in_(mine or {-1}))
    if warehouse_id is not None:
        stmt = stmt.where(StockMovement.location_id == warehouse_id)
    if item_id is not None:
        stmt = stmt.where(StockMovement.item_id == item_id)
    rows = []
    for iid, wid, qty in db.execute(stmt).all():
        on_hand = to_qty(qty or 0)
        if on_hand == to_qty(0):
            continue
        rows.append({
            "item_id": iid, "item_name": names.get(iid, ""), "warehouse_id": wid,
            "on_hand": str(on_hand), "unit_cost": str(prices.get(iid, ZERO)),
            "value": str(to_money(on_hand * prices.get(iid, ZERO))),
        })
    rows.sort(key=lambda r: (r["warehouse_id"], r["item_name"]))
    return {"rows": rows}


def wastage(db: Session, *, date_from=None, date_to=None, item_id: int | None = None,
            warehouse_id: int | None = None) -> dict:
    """Waste from manufacturing orders (per-line waste_quantity) + standalone wastage documents."""
    names = _item_names(db)
    prices = {i.id: (to_money(i.purchase_price) if i.purchase_price is not None else ZERO)
              for i in db.scalars(select(Item)).all()}
    rows, total_qty, total_cost = [], ZERO, ZERO

    # From manufacturing orders (non-reversal), any consumption line with waste.
    q = (select(ManufacturingOrderConsumption, ManufacturingOrder)
         .join(ManufacturingOrder, ManufacturingOrder.id == ManufacturingOrderConsumption.order_id)
         .where(ManufacturingOrder.reverses_order_id.is_(None)))
    for cons, order in db.execute(q).all():
        wq = to_qty(cons.waste_quantity)
        if wq <= to_qty(0):
            continue
        if item_id is not None and cons.item_id != item_id:
            continue
        if warehouse_id is not None and cons.warehouse_id != warehouse_id:
            continue
        if not _in_range(order.created_at, date_from, date_to):
            continue
        cost = to_money(wq * prices.get(cons.item_id, ZERO))
        total_qty += wq
        total_cost += cost
        rows.append({"source": "manufacturing", "document_number": order.document_number,
                     "item_id": cons.item_id, "item_name": names.get(cons.item_id, ""),
                     "warehouse_id": cons.warehouse_id, "quantity": str(wq),
                     "cost": str(cost), "created_at": str(order.created_at)})

    # Standalone wastage documents (exclude reversals; reversals net out).
    for d in db.scalars(select(WastageDocument).where(WastageDocument.reverses_id.is_(None))).all():
        if item_id is not None and d.item_id != item_id:
            continue
        if warehouse_id is not None and d.warehouse_id != warehouse_id:
            continue
        if not _in_range(d.created_at, date_from, date_to):
            continue
        # Skip if this document has been reversed.
        reversed_ = db.scalar(select(WastageDocument.id).where(WastageDocument.reverses_id == d.id))
        if reversed_ is not None:
            continue
        total_qty += to_qty(d.quantity)
        total_cost += to_money(d.total_cost)
        rows.append({"source": "document", "document_number": d.document_number,
                     "item_id": d.item_id, "item_name": names.get(d.item_id, ""),
                     "warehouse_id": d.warehouse_id, "quantity": str(to_qty(d.quantity)),
                     "cost": str(to_money(d.total_cost)), "created_at": str(d.created_at)})

    rows.sort(key=lambda r: r["created_at"])
    return {"rows": rows, "total_quantity": str(to_qty(total_qty)),
            "total_cost": str(to_money(total_cost))}


def last_sold_by_item(db: Session) -> dict[int, date]:
    """آخر يوم اتباع فيه كل صنف — **لعميل، وبتاريخ الفاتورة**.

    حاجتين كانوا غلط هنا وفي فحص الرئيسية، وكل واحدة لوحدها بتكفي تخلّي التقرير
    مالوش معنى:

    * **التاريخ كان `created_at`** — وده وقت كتابة السطر في قاعدتنا مش وقت الحركة.
      نقل a5 كتب ٤٤ ألف حركة في تسع أيام والفواتير وراها من يناير، فكل حركة منقولة
      كانت مكتوب عليها إنها حصلت الأسبوع اللي فات.
    * **التحويل كان بيتحسب حركة.** نقل البضاعة من المخزن الرئيسي لعربية المندوب مش
      بيع — البضاعة لسه عندنا. فالصنف اللي بيتنقل ومابيتباعش كان بيبان متحرّك.

    فالمقياس بقى: **اتباع لعميل امتى آخر مرة**، بتاريخ الفاتورة، ولكل صنف مرة واحدة
    مهما كان في كام مخزن.
    """
    when = func.max(SalesInvoice.invoice_date)
    rows = db.execute(
        select(StockMovement.item_id, when)
        .join(SalesInvoice, SalesInvoice.id == StockMovement.source_doc_id)
        .where(StockMovement.source_doc_type == StockDoc.SALE,
               StockMovement.direction == StockDirection.out)
        .group_by(StockMovement.item_id)
    ).all()
    return {iid: d for iid, d in rows if d is not None}


def stagnant_stock(db: Session, *, days: int = 90, warehouse_id: int | None = None,
                   now: datetime | None = None, branch_id: int | None = None) -> dict:
    """بضاعة عليها رصيد ومحصلش عليها بيع من `days` يوم — أو ولا مرة.

    **الركود صفة الصنف مش صفة مكانه.** كان بيتحسب لكل (صنف × مخزن)، فالصنف اللي في
    خمس مخازن وبيتباع من واحد بيتعدّ أربع مرات راكد. على داتا العميل ده كان بيطلّع
    ٦٠٩ سطر من ٩٣٣ موقع رصيد — تلتين المخزن «راكد»، وتقرير بيقول كده مش تقرير.

    بالقياس الصح — اتباع لعميل امتى — الرقم بقى ٢٤٩ صنف. والسطور بتفضل مفصّلة بالمخزن
    عشان اللي هيتصرّف يعرف يروح فين، بس **القرار للصنف**.
    """
    now = now or datetime.utcnow()
    cutoff = _as_date(now) - timedelta(days=days)
    names = _item_names(db)
    prices = {i.id: (to_money(i.purchase_price) if i.purchase_price is not None else ZERO)
              for i in db.scalars(select(Item)).all()}
    last_sold = last_sold_by_item(db)

    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    on_hand_stmt = (select(StockMovement.item_id, StockMovement.location_id, signed)
                    .where(StockMovement.location_kind == LocationKind.warehouse)
                    .group_by(StockMovement.item_id, StockMovement.location_id))
    mine = branch_warehouse_ids(db, branch_id)
    if mine is not None:
        on_hand_stmt = on_hand_stmt.where(StockMovement.location_id.in_(mine or {-1}))
    if warehouse_id is not None:
        on_hand_stmt = on_hand_stmt.where(StockMovement.location_id == warehouse_id)

    rows = []
    for iid, wid, qty in db.execute(on_hand_stmt).all():
        on_hand = to_qty(qty or 0)
        if on_hand <= to_qty(0):
            continue
        sold = last_sold.get(iid)
        if sold is not None and sold >= cutoff:
            continue                      # اتباع قريّب — مش راكد
        rows.append({
            "item_id": iid, "item_name": names.get(iid, ""), "warehouse_id": wid,
            "on_hand": str(on_hand), "last_out_date": str(sold) if sold else None,
            "value": str(to_money(on_hand * prices.get(iid, ZERO))),
        })
    rows.sort(key=lambda r: (r["last_out_date"] or "", r["item_name"]))
    return {"days": days, "as_of": str(_as_date(now)), "rows": rows,
            # العدد اللي بيتقال للمستخدم — أصناف، مش مواقع رصيد.
            "item_count": len({r["item_id"] for r in rows})}


def sales(db: Session, *, date_from=None, date_to=None, period="month") -> dict:
    """Sales gross/net bucketed by period (for linking sales volume to production)."""
    rows, buckets = [], {}
    gross_total = net_total = ZERO
    for inv in db.scalars(select(SalesInvoice).order_by(SalesInvoice.id)).all():
        if not _in_range(inv.invoice_date or inv.created_at, date_from, date_to):
            continue
        gross_total += to_money(inv.gross)
        net_total += to_money(inv.net)
        rows.append({"document_number": inv.document_number, "customer_id": inv.customer_id,
                     "gross": str(to_money(inv.gross)), "net": str(to_money(inv.net)),
                     "created_at": str(inv.invoice_date or inv.created_at)})
        b = buckets.setdefault(bucket_key(inv.invoice_date or inv.created_at, period), {"gross": ZERO, "net": ZERO})
        b["gross"] += to_money(inv.gross)
        b["net"] += to_money(inv.net)
    return {
        "rows": rows, "gross_total": str(to_money(gross_total)), "net_total": str(to_money(net_total)),
        "by_period": [{"period": k, "gross": str(to_money(v["gross"])), "net": str(to_money(v["net"]))}
                      for k, v in sorted(buckets.items())],
    }


def reorder(db: Session) -> dict:
    """Items whose total on-hand has drifted outside their advisory min/max limits (011).

    Only items that are actually a planning problem are listed: below the floor (buy more) or above
    the ceiling (too much cash tied up). An item sitting comfortably in range, or with no limits
    set at all, is not a problem and would only be noise here.
    """
    signed = func.sum(case(
        (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
        else_=-StockMovement.quantity,
    ))
    on_hand = {
        item_id: to_qty(total)
        for item_id, total in db.execute(
            select(StockMovement.item_id, signed).group_by(StockMovement.item_id)
        ).all()
    }

    rows = []
    for item in db.scalars(
        select(Item).where(Item.active.is_(True)).order_by(Item.name)
    ).all():
        if item.min_stock is None and item.max_stock is None:
            continue
        have = on_hand.get(item.id, to_qty(0))
        if item.min_stock is not None and have < to_qty(item.min_stock):
            flag = "below_min"
        elif item.max_stock is not None and have > to_qty(item.max_stock):
            flag = "above_max"
        else:
            continue
        rows.append({
            "item_id": item.id, "code": item.code, "name": item.name,
            "unit_of_measure": item.unit_of_measure,
            "on_hand": str(have),
            "min_stock": str(to_qty(item.min_stock)) if item.min_stock is not None else None,
            "max_stock": str(to_qty(item.max_stock)) if item.max_stock is not None else None,
            # How much to buy to reach the floor — the number the buyer actually acts on.
            "shortfall": str(to_qty(item.min_stock) - have)
                         if flag == "below_min" else None,
            "excess": str(have - to_qty(item.max_stock)) if flag == "above_max" else None,
            "flag": flag,
        })
    return {"rows": rows,
            "below_min": sum(1 for r in rows if r["flag"] == "below_min"),
            "above_max": sum(1 for r in rows if r["flag"] == "above_max")}
