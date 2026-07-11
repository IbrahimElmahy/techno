"""Full demo dataset for the company — for testing every module end-to-end.

Idempotent: does nothing if the demo catalog already exists. Builds on top of `scripts.bootstrap`
(org, warehouses, users, chart). Uses the real services so every ledger entry, stock movement and
cost is correct — the seeded data exercises purchases → manufacturing (recipes + resources + routing
+ waste) → wastage → sales.

Run locally:  python -m scripts.demo_seed   (after bootstrap)
Or via API:   POST /api/v1/admin/demo-seed  (system admin)
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.catalog import Item, ItemKind
from src.models.ledger import Account, AccountType, Direction
from src.models.org import Territory
from src.models.role import RoleName
from src.models.supplier import Supplier, SupplierAccount
from src.models.user import User
from src.models.warehouse import Warehouse, WarehouseType
from src.services import (
    customer_service,
    manufacturing_service,
    purchase_service,
    sales_service,
    wastage_service,
)
from src.services.purchase_service import PurchaseLine
from src.services.sales_service import SaleLine

MARKER = "كوع PVC ½ بوصة"  # presence of this product means the demo is already seeded


def already_seeded(db: Session) -> bool:
    return db.scalar(select(Item.id).where(Item.name == MARKER)) is not None


def _warehouse(db: Session, name: str) -> Warehouse:
    wh = db.scalar(select(Warehouse).where(Warehouse.name == name))
    if wh is None:
        wh = Warehouse(name=name, warehouse_type=WarehouseType.central)
        db.add(wh)
        db.flush()
    return wh


def _supplier(db: Session, name: str, phone: str) -> Supplier:
    acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit)
    db.add(acc)
    db.flush()
    code = f"SUP-{db.query(Supplier).count() + 1:05d}"
    s = Supplier(code=code, name=name, phone=phone)
    db.add(s)
    db.flush()
    db.add(SupplierAccount(supplier_id=s.id, account_id=acc.id))
    db.flush()
    return s


def _item(db: Session, *, name, kind, uom, warehouse_id, purchase=None, sale=None) -> Item:
    prefix = "RM" if kind == ItemKind.raw_material else "PR"
    n = db.query(Item).filter(Item.kind == kind).count()
    it = Item(code=f"{prefix}-{n + 1:06d}", name=name, kind=kind, unit_of_measure=uom,
              purchase_price=Decimal(purchase) if purchase else None,
              sale_price=Decimal(sale) if sale else None, default_warehouse_id=warehouse_id)
    db.add(it)
    db.flush()
    return it


def seed_demo(db: Session) -> dict:
    """Create the full demo dataset. Returns a summary; safe to call more than once."""
    if already_seeded(db):
        return {"status": "already_seeded"}

    admin = db.scalar(select(User).where(User.username == "admin"))
    rep = db.scalar(select(User).where(User.username == "rep"))
    territory = db.scalar(select(Territory))
    actor = admin.id

    raw_wh = _warehouse(db, "مخزن الخامات")
    prod_wh = _warehouse(db, "مخزن المنتجات التامة")

    # --- Raw materials (routed to the raw warehouse) ---
    pvc = _item(db, name="حبيبات PVC", kind=ItemKind.raw_material, uom="كجم",
                warehouse_id=raw_wh.id, purchase="18")
    stabilizer = _item(db, name="مثبّت حراري", kind=ItemKind.raw_material, uom="كجم",
                       warehouse_id=raw_wh.id, purchase="45")
    pigment = _item(db, name="صبغة", kind=ItemKind.raw_material, uom="كجم",
                    warehouse_id=raw_wh.id, purchase="60")
    carton = _item(db, name="كرتون تغليف", kind=ItemKind.raw_material, uom="قطعة",
                   warehouse_id=raw_wh.id, purchase="3")
    # A raw material purchased but never used — appears in the stagnant (رواكد) report.
    old_stock = _item(db, name="خامة قديمة (راكدة)", kind=ItemKind.raw_material, uom="كجم",
                      warehouse_id=raw_wh.id, purchase="25")

    # --- Products (routed to the finished-goods warehouse) ---
    elbow = _item(db, name=MARKER, kind=ItemKind.product, uom="قطعة",
                  warehouse_id=prod_wh.id, sale="7")
    tee = _item(db, name="تيه PVC ½ بوصة", kind=ItemKind.product, uom="قطعة",
                warehouse_id=prod_wh.id, sale="9")
    pipe = _item(db, name="ماسورة PVC 4 متر", kind=ItemKind.product, uom="قطعة",
                 warehouse_id=prod_wh.id, sale="35")

    # --- Suppliers ---
    sup_a = _supplier(db, "الشركة المصرية للبتروكيماويات", "01000000001")
    sup_b = _supplier(db, "موّرد الإضافات والصبغات", "01000000002")

    # --- Purchases: stock the raw materials into the raw warehouse ---
    def purchase(supplier, lines_spec, cash_ratio=Decimal("1")):
        lines = [PurchaseLine(it.id, Decimal(q), Decimal(p)) for it, q, p in lines_spec]
        total = sum((Decimal(q) * Decimal(p) for _, q, p in lines_spec), Decimal("0"))
        cash = (total * cash_ratio).quantize(Decimal("0.01"))
        purchase_service.create_purchase(
            db, supplier_id=supplier.id, location_kind="warehouse", location_id=raw_wh.id,
            cash_amount=cash, credit_amount=total - cash, lines=lines,
            actor_role=RoleName.system_admin, actor_user_id=actor)

    purchase(sup_a, [(pvc, "2000", "18"), (carton, "1000", "3")], Decimal("0.5"))
    purchase(sup_b, [(stabilizer, "200", "45"), (pigment, "100", "60"),
                     (old_stock, "80", "25")], Decimal("1"))

    # --- Recipes (BOM) with material components + production resources ---
    def bom(product, components, resources):
        return manufacturing_service.create_bom(
            db, product_id=product.id, name=f"وصفة {product.name}", output_quantity=Decimal("100"),
            components=[(it.id, Decimal(q)) for it, q in components],
            resources=[(k, n, Decimal(q), Decimal(r)) for k, n, q, r in resources],
            actor_user_id=actor)

    bom(elbow, [(pvc, "20"), (stabilizer, "1"), (carton, "10")],
        [("labor", "عمالة تشكيل", "4", "25"), ("machine", "تشغيل مكبس", "2", "40")])
    bom(tee, [(pvc, "28"), (stabilizer, "1.5"), (pigment, "0.5"), (carton, "10")],
        [("labor", "عمالة تشكيل", "5", "25"), ("machine", "تشغيل مكبس", "3", "40")])
    bom(pipe, [(pvc, "120"), (stabilizer, "5"), (carton, "5")],
        [("labor", "عمالة بثق", "8", "25"), ("machine", "تشغيل خط البثق", "6", "55")])

    # --- Manufacturing orders (auto-route + cost + some waste) ---
    manufacturing_service.create_order(
        db, product_id=elbow.id, quantity=Decimal("500"), location_kind="warehouse",
        location_id=prod_wh.id, actor_user_id=actor,
        wastes={pvc.id: Decimal("3")})
    manufacturing_service.create_order(
        db, product_id=tee.id, quantity=Decimal("300"), location_kind="warehouse",
        location_id=prod_wh.id, actor_user_id=actor)
    manufacturing_service.create_order(
        db, product_id=pipe.id, quantity=Decimal("100"), location_kind="warehouse",
        location_id=prod_wh.id, actor_user_id=actor)

    # --- Wastage document (damaged raw material) ---
    wastage_service.create_wastage(
        db, item_id=carton.id, warehouse_id=raw_wh.id, quantity=Decimal("15"),
        reason="كرتون تالف بسبب الرطوبة", actor_user_id=actor)

    # --- Customers (owned by the seeded rep + territory) ---
    def customer(name, ctype, phone):
        return customer_service.create_customer(
            db, name=name, customer_type=ctype, rep_id=rep.id, territory_id=territory.id,
            phone=phone, actor_user_id=actor).customer

    c1 = customer("مؤسسة النور للأدوات الصحية", "trader", "01111111111")
    c2 = customer("سباك - أحمد عبد الله", "plumber", "01222222222")
    customer("معرض المستقبل", "trader", "01333333333")

    # --- Sales (from the finished-goods warehouse; mix of cash/credit) ---
    def sale(cust, lines_spec, cash_ratio=Decimal("1")):
        lines = [SaleLine(it.id, Decimal(q)) for it, q in lines_spec]
        net = sum((Decimal(q) * Decimal(it.sale_price) for it, q in lines_spec), Decimal("0"))
        cash = (net * cash_ratio).quantize(Decimal("0.01"))
        sales_service.create_sale(
            db, customer_id=cust.id, origin_location_kind="warehouse", origin_location_id=prod_wh.id,
            variable_discount_pct=Decimal("0"), cash_amount=cash, credit_amount=net - cash,
            lines=lines, actor_role=RoleName.system_admin, actor_user_id=actor)

    sale(c1, [(elbow, "120"), (tee, "80")], Decimal("0.5"))
    sale(c2, [(elbow, "50"), (pipe, "20")], Decimal("1"))
    sale(c1, [(pipe, "30")], Decimal("0"))

    db.commit()
    return {
        "status": "seeded",
        "raw_materials": 5, "products": 3, "suppliers": 2, "customers": 3,
        "purchases": 2, "recipes": 3, "manufacturing_orders": 3, "wastage_docs": 1, "sales": 3,
        "warehouses": {"raw": raw_wh.id, "finished": prod_wh.id},
    }


def main() -> None:
    from src.core.db import SessionLocal
    db = SessionLocal()
    try:
        print(seed_demo(db))
    finally:
        db.close()


if __name__ == "__main__":
    main()
