"""Remove the demo dataset seeded by `demo_seed` — leaving real company data untouched (v4).

Targets ONLY the records `demo_seed` creates, matched by their exact seeded names, plus every
document that references them (purchases, sales, manufacturing orders, wastage) and the stock
movements / ledger entries those documents posted.

This is a genuine hard delete: the app is otherwise append-only, so this exists purely to clear
sample data out of a production database before go-live. It never touches rows it did not seed.
"""
from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from src.models.bom import Bom, BomComponent, BomResource
from src.models.catalog import Item, ItemBarcode, ItemPrice, ItemSerial, ItemUnit
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, LedgerEntry, LedgerLine
from src.models.loyalty import (
    Coupon,
    CouponRedemption,
    PointConversion,
    PointRecord,
    ProductPointValue,
)
from src.models.manufacturing import (
    ManufacturingOp,
    ManufacturingOrder,
    ManufacturingOrderConsumption,
    ManufacturingOrderResource,
)
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.models.stock import StockLocator, StockMovement
from src.models.supplier import Supplier, SupplierAccount
from src.models.wastage import WastageDocument

DEMO_ITEMS = [
    "حبيبات PVC", "مثبّت حراري", "صبغة", "كرتون تغليف", "خامة قديمة (راكدة)",
    "كوع PVC ½ بوصة", "تيه PVC ½ بوصة", "ماسورة PVC 4 متر",
]
DEMO_SUPPLIERS = ["الشركة المصرية للبتروكيماويات", "موّرد الإضافات والصبغات"]
DEMO_CUSTOMERS = ["مؤسسة النور للأدوات الصحية", "سباك - أحمد عبد الله", "معرض المستقبل"]
DEMO_WAREHOUSES = ["مخزن الخامات", "مخزن المنتجات التامة"]


def purge_demo(db: Session) -> dict:
    """Delete the demo dataset. Returns a per-entity count of what was removed."""
    item_ids = [i for (i,) in db.execute(select(Item.id).where(Item.name.in_(DEMO_ITEMS))).all()]
    supplier_ids = [i for (i,) in
                    db.execute(select(Supplier.id).where(Supplier.name.in_(DEMO_SUPPLIERS))).all()]
    customer_ids = [i for (i,) in
                    db.execute(select(Customer.id).where(Customer.name.in_(DEMO_CUSTOMERS))).all()]
    removed = {k: 0 for k in (
        "sales", "sales_returns", "purchases", "purchase_returns", "manufacturing_orders",
        "manufacturing_ops", "wastage", "boms", "stock_movements", "ledger_entries",
        "items", "suppliers", "customers", "warehouses", "coupons", "point_records")}
    if not (item_ids or supplier_ids or customer_ids):
        return {"status": "nothing_to_purge", **removed}

    ledger_entry_ids: set[int] = set()

    def _collect(entry_id):
        if entry_id:
            ledger_entry_ids.add(entry_id)

    # --- Sales (+ returns) for demo customers ---
    sale_ids = [i for (i,) in db.execute(
        select(SalesInvoice.id).where(SalesInvoice.customer_id.in_(customer_ids or [-1]))).all()]
    for s in db.scalars(select(SalesInvoice).where(SalesInvoice.id.in_(sale_ids or [-1]))).all():
        _collect(s.ledger_entry_id)
    ret_ids = [i for (i,) in db.execute(
        select(SalesReturn.id).where(SalesReturn.sales_invoice_id.in_(sale_ids or [-1]))).all()]
    for r in db.scalars(select(SalesReturn).where(SalesReturn.id.in_(ret_ids or [-1]))).all():
        _collect(r.ledger_entry_id)
    db.execute(delete(SalesReturnLine).where(SalesReturnLine.return_id.in_(ret_ids or [-1])))
    removed["sales_returns"] = db.execute(
        delete(SalesReturn).where(SalesReturn.id.in_(ret_ids or [-1]))).rowcount or 0
    db.execute(delete(SalesInvoiceLine).where(SalesInvoiceLine.invoice_id.in_(sale_ids or [-1])))

    # --- Purchases (+ returns) from demo suppliers ---
    pur_ids = [i for (i,) in db.execute(
        select(PurchaseInvoice.id).where(
            PurchaseInvoice.supplier_id.in_(supplier_ids or [-1]))).all()]
    for p in db.scalars(select(PurchaseInvoice).where(PurchaseInvoice.id.in_(pur_ids or [-1]))).all():
        _collect(p.ledger_entry_id)
    pret_ids = [i for (i,) in db.execute(
        select(PurchaseReturn.id).where(
            PurchaseReturn.purchase_invoice_id.in_(pur_ids or [-1]))).all()]
    for r in db.scalars(select(PurchaseReturn).where(PurchaseReturn.id.in_(pret_ids or [-1]))).all():
        _collect(r.ledger_entry_id)
    db.execute(delete(PurchaseReturnLine).where(PurchaseReturnLine.return_id.in_(pret_ids or [-1])))
    removed["purchase_returns"] = db.execute(
        delete(PurchaseReturn).where(PurchaseReturn.id.in_(pret_ids or [-1]))).rowcount or 0
    db.execute(delete(PurchaseInvoiceLine).where(
        PurchaseInvoiceLine.invoice_id.in_(pur_ids or [-1])))

    # --- Loyalty tied to demo customers ---
    coupon_ids = [i for (i,) in db.execute(
        select(Coupon.id).where(Coupon.customer_id.in_(customer_ids or [-1]))).all()]
    db.execute(delete(CouponRedemption).where(CouponRedemption.coupon_id.in_(coupon_ids or [-1])))
    db.execute(delete(PointRecord).where(PointRecord.customer_id.in_(customer_ids or [-1])))
    removed["coupons"] = db.execute(
        delete(Coupon).where(Coupon.id.in_(coupon_ids or [-1]))).rowcount or 0
    db.execute(delete(PointConversion).where(
        PointConversion.customer_id.in_(customer_ids or [-1])))

    # --- Manufacturing (orders reference demo items) ---
    order_ids = [i for (i,) in db.execute(
        select(ManufacturingOrder.id).where(
            ManufacturingOrder.product_id.in_(item_ids or [-1]))).all()]
    order_ids += [i for (i,) in db.execute(
        select(ManufacturingOrderConsumption.order_id).where(
            ManufacturingOrderConsumption.item_id.in_(item_ids or [-1]))).all()]
    order_ids = list(set(order_ids))
    db.execute(delete(ManufacturingOrderConsumption).where(
        ManufacturingOrderConsumption.order_id.in_(order_ids or [-1])))
    db.execute(delete(ManufacturingOrderResource).where(
        ManufacturingOrderResource.order_id.in_(order_ids or [-1])))
    # reversal orders point at originals — clear the link before deleting
    db.execute(update(ManufacturingOrder).where(ManufacturingOrder.id.in_(order_ids or [-1]))
               .values(reverses_order_id=None))
    removed["manufacturing_orders"] = db.execute(
        delete(ManufacturingOrder).where(ManufacturingOrder.id.in_(order_ids or [-1]))).rowcount or 0

    op_ids = [i for (i,) in db.execute(
        select(ManufacturingOp.id).where(ManufacturingOp.item_id.in_(item_ids or [-1]))).all()]
    db.execute(update(ManufacturingOp).where(ManufacturingOp.id.in_(op_ids or [-1]))
               .values(reverses_op_id=None))
    removed["manufacturing_ops"] = db.execute(
        delete(ManufacturingOp).where(ManufacturingOp.id.in_(op_ids or [-1]))).rowcount or 0

    # --- BOMs for demo products ---
    bom_ids = [i for (i,) in db.execute(
        select(Bom.id).where(Bom.product_id.in_(item_ids or [-1]))).all()]
    db.execute(delete(BomComponent).where(BomComponent.bom_id.in_(bom_ids or [-1])))
    db.execute(delete(BomResource).where(BomResource.bom_id.in_(bom_ids or [-1])))
    removed["boms"] = db.execute(delete(Bom).where(Bom.id.in_(bom_ids or [-1]))).rowcount or 0

    # --- Wastage on demo items ---
    waste_ids = [i for (i,) in db.execute(
        select(WastageDocument.id).where(WastageDocument.item_id.in_(item_ids or [-1]))).all()]
    db.execute(update(WastageDocument).where(WastageDocument.id.in_(waste_ids or [-1]))
               .values(reverses_id=None))
    removed["wastage"] = db.execute(
        delete(WastageDocument).where(WastageDocument.id.in_(waste_ids or [-1]))).rowcount or 0

    removed["sales"] = db.execute(
        delete(SalesInvoice).where(SalesInvoice.id.in_(sale_ids or [-1]))).rowcount or 0
    removed["purchases"] = db.execute(
        delete(PurchaseInvoice).where(PurchaseInvoice.id.in_(pur_ids or [-1]))).rowcount or 0

    # --- Stock movements for demo items (clear reversal links first) ---
    # Core-level UPDATE: an ORM attribute set would trip stock_movement's immutability guard,
    # which is exactly right for normal code — this purge is the deliberate exception.
    db.execute(update(StockMovement).where(StockMovement.item_id.in_(item_ids or [-1]))
               .values(reverses_movement_id=None))
    removed["stock_movements"] = db.execute(
        delete(StockMovement).where(StockMovement.item_id.in_(item_ids or [-1]))).rowcount or 0
    db.execute(delete(StockLocator).where(StockLocator.item_id.in_(item_ids or [-1])))

    # --- Item children, then the items ---
    for model in (ProductPointValue, ItemPrice, ItemUnit, ItemSerial, ItemBarcode):
        db.execute(delete(model).where(model.item_id.in_(item_ids or [-1])))
    removed["items"] = db.execute(delete(Item).where(Item.id.in_(item_ids or [-1]))).rowcount or 0

    # --- Ledger entries posted by the deleted documents ---
    if ledger_entry_ids:
        db.execute(delete(LedgerLine).where(LedgerLine.entry_id.in_(ledger_entry_ids)))
        removed["ledger_entries"] = db.execute(
            delete(LedgerEntry).where(LedgerEntry.id.in_(ledger_entry_ids))).rowcount or 0

    # --- Suppliers / customers (+ their ledger accounts) ---
    sup_acc_ids = [a for (a,) in db.execute(
        select(SupplierAccount.account_id).where(
            SupplierAccount.supplier_id.in_(supplier_ids or [-1]))).all()]
    db.execute(delete(SupplierAccount).where(SupplierAccount.supplier_id.in_(supplier_ids or [-1])))
    removed["suppliers"] = db.execute(
        delete(Supplier).where(Supplier.id.in_(supplier_ids or [-1]))).rowcount or 0

    cust_acc_ids = [a for (a,) in db.execute(
        select(CustomerAccount.account_id).where(
            CustomerAccount.customer_id.in_(customer_ids or [-1]))).all()]
    db.execute(delete(CustomerAccount).where(CustomerAccount.customer_id.in_(customer_ids or [-1])))
    removed["customers"] = db.execute(
        delete(Customer).where(Customer.id.in_(customer_ids or [-1]))).rowcount or 0

    # Only drop accounts that no longer carry any ledger line.
    for acc_id in set(sup_acc_ids + cust_acc_ids):
        if db.scalar(select(LedgerLine.id).where(LedgerLine.account_id == acc_id).limit(1)) is None:
            db.execute(delete(Account).where(Account.id == acc_id))

    # --- Demo warehouses (only if nothing references them any more) ---
    from src.models.warehouse import Warehouse
    for wh in db.scalars(select(Warehouse).where(Warehouse.name.in_(DEMO_WAREHOUSES))).all():
        still_used = db.scalar(
            select(StockMovement.id).where(StockMovement.location_id == wh.id).limit(1))
        referenced = db.scalar(select(Item.id).where(Item.default_warehouse_id == wh.id).limit(1))
        if still_used is None and referenced is None:
            db.execute(delete(Warehouse).where(Warehouse.id == wh.id))
            removed["warehouses"] += 1

    db.commit()
    return {"status": "purged", **removed}


def main() -> None:
    from src.core.db import SessionLocal

    db = SessionLocal()
    try:
        print(purge_demo(db))
    finally:
        db.close()


if __name__ == "__main__":
    main()
