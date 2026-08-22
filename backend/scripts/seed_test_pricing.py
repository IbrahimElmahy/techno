"""داتا تجربة للتسعير — خصومات ونقاط على أصناف معروفة.

الفاتورة بتاخد الخصم بالأولوية دي:

    خصم العميل  ←  خصم فئة سعره  ←  خصم الصنف العام

والشاشة مابتخترعش أرقام: لو التلاتة فاضيين، بتعرض صفر — وده اللي كان بيبان كأنه عطل.
السكريبت ده بيملا التلات مستويات على أصناف بعينها عشان كل مستوى يتجرّب لوحده ويتشاف
إنه بيكسب اللي تحته.

    py -3.11 backend/scripts/seed_test_pricing.py            # يعرض بس
    py -3.11 backend/scripts/seed_test_pricing.py --apply    # يكتب

**بيكتب على قاعدة التطوير المحلية** (`DATABASE_URL` من `.env`)، ومابيلمسش أي صنف غير
اللي مسمّى تحت. والتشغيل مرتين بيدّي نفس النتيجة.
"""
from __future__ import annotations

import os
import sys
from decimal import Decimal

from sqlalchemy import create_engine, text

DB = os.environ.get(
    "DATABASE_URL",
    "mysql+pymysql://ubms_user:ubms_dev_2026@localhost:3306/ubms?charset=utf8mb4",
)

# الأصناف اللي هتتجرّب بيها، وكل واحد بيوضّح مستوى مختلف:
#
#   (اسم الصنف, خصم الصنف, خصم فئة «مستهلك», خصم فئة «جملة», نقاط)
#
# «هاتف» خصمه على الصنف بس — يبان لأي عميل مهما كانت فئته.
# «تيه PVC» خصمه على الفئة كمان وأعلى — عشان يتشاف إن الفئة بتكسب الصنف.
# «لبن طازج» نقاطه عالية — عشان عمود النقاط يبان برقم واضح.
ITEMS: list[tuple[str, Decimal, Decimal | None, Decimal | None, Decimal]] = [
    ("هاتف", Decimal("5"), None, None, Decimal("2")),
    ("تيه PVC ½ بوصة", Decimal("5"), Decimal("12"), Decimal("18"), Decimal("0.5")),
    ("كوع PVC ½ بوصة", Decimal("8"), None, None, Decimal("0.5")),
    ("لبن طازج", Decimal("10"), Decimal("15"), Decimal("20"), Decimal("3")),
    ("جهاز مسلسل ت٢", Decimal("7"), None, None, Decimal("5")),
]

# عميل بخصم على شخصه — بيكسب أي خصم على الصنف أو الفئة.
CUSTOMER_WITH_DISCOUNT = ("ممدوح جبر", Decimal("25"))
# وعميل على فئة «جملة» — عشان خصم الفئة يتجرّب.
CUSTOMER_WHOLESALE = "عميل الجملة"

APPLY = "--apply" in sys.argv


def main() -> None:
    engine = create_engine(DB)
    changes: list[str] = []
    with engine.begin() as c:
        for name, item_disc, cons_disc, whole_disc, points in ITEMS:
            rows = c.execute(text(
                "SELECT id, sale_price FROM item "
                "WHERE name = :n AND kind = 'product' AND active = 1"), {"n": name}).all()
            if not rows:
                changes.append(f"! مافيش صنف اسمه «{name}» — اتخطّى")
                continue
            for item_id, price in rows:
                changes.append(f"«{name}» #{item_id}: خصم الصنف = {item_disc}%، نقاط = {points}")
                if APPLY:
                    c.execute(text("UPDATE item SET default_discount_pct = :d WHERE id = :i"),
                              {"d": item_disc, "i": item_id})
                    # النقاط في جدولها — upsert يدوي عشان يشتغل على أي محرك.
                    exists = c.execute(text(
                        "SELECT 1 FROM product_point_value WHERE item_id = :i"),
                        {"i": item_id}).first()
                    if exists:
                        c.execute(text(
                            "UPDATE product_point_value SET point_value = :p WHERE item_id = :i"),
                            {"p": points, "i": item_id})
                    else:
                        c.execute(text(
                            "INSERT INTO product_point_value (item_id, point_value) "
                            "VALUES (:i, :p)"), {"i": item_id, "p": points})

                # أسعار الفئات: السعر لازم يبقى موجود عشان الصف يتكتب أصلاً، والخصم عليه.
                base = Decimal(str(price or 0))
                for tier, disc, factor in (
                    ("consumer", cons_disc, Decimal("1.00")),
                    ("wholesale", whole_disc, Decimal("0.85")),
                ):
                    if disc is None:
                        continue
                    tier_price = (base * factor).quantize(Decimal("0.01"))
                    changes.append(
                        f"    فئة {tier}: سعر {tier_price} وخصم {disc}%")
                    if APPLY:
                        found = c.execute(text(
                            "SELECT 1 FROM item_price WHERE item_id = :i AND tier = :t"),
                            {"i": item_id, "t": tier}).first()
                        if found:
                            c.execute(text(
                                "UPDATE item_price SET price = :p, discount_pct = :d "
                                "WHERE item_id = :i AND tier = :t"),
                                {"p": tier_price, "d": disc, "i": item_id, "t": tier})
                        else:
                            c.execute(text(
                                "INSERT INTO item_price (item_id, tier, price, discount_pct, "
                                "vat_pct) VALUES (:i, :t, :p, :d, 0)"),
                                {"i": item_id, "t": tier, "p": tier_price, "d": disc})

        name, disc = CUSTOMER_WITH_DISCOUNT
        row = c.execute(text(
            "SELECT id FROM customer WHERE name = :n AND active = 1 "
            "ORDER BY id DESC LIMIT 1"), {"n": name}).first()
        if row:
            changes.append(f"العميل «{name}» #{row[0]}: خصم شخصي = {disc}% (بيكسب كل اللي فوق)")
            if APPLY:
                c.execute(text("UPDATE customer SET discount_pct = :d WHERE id = :i"),
                          {"d": disc, "i": row[0]})

        row = c.execute(text(
            "SELECT id FROM customer WHERE name = :n AND active = 1 "
            "ORDER BY id DESC LIMIT 1"), {"n": CUSTOMER_WHOLESALE}).first()
        if row:
            changes.append(f"العميل «{CUSTOMER_WHOLESALE}» #{row[0]}: فئة = جملة")
            if APPLY:
                c.execute(text(
                    "UPDATE customer SET default_price_tier = 'wholesale', "
                    "discount_pct = NULL WHERE id = :i"), {"i": row[0]})

    print("\n".join(changes))
    print()
    if APPLY:
        print("✔ اتكتبت. اعمل تحديث للصفحة (Ctrl+F5) عشان الشاشة تسحب الأسعار من جديد.")
        print()
        print("جرّب كده:")
        print("  ١) عميل «عميل الجملة» + صنف «تيه PVC ½ بوصة» → خصم ١٨٪ (خصم فئة الجملة)")
        print("  ٢) أي عميل تاني   + نفس الصنف              → خصم ١٢٪ (خصم فئة المستهلك)")
        print("  ٣) عميل «ممدوح جبر» + أي صنف                → خصم ٢٥٪ (خصمه الشخصي بيكسب)")
        print("  ٤) صنف «لبن طازج» كمية ٤                    → النقاط ١٢")
    else:
        print("ده عرض بس — ضيف --apply عشان يتكتب فعلاً.")


if __name__ == "__main__":
    main()
