from __future__ import annotations

import argparse
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import ItemPrice, PriceTier
from src.models.customer import Customer
from src.models.org import Branch
from src.models.sales import SalesInvoice, SalesInvoiceLine
from src.services import audit_service

ORDER = (PriceTier.commercial, PriceTier.semi_commercial, PriceTier.wholesale,
         PriceTier.semi_wholesale, PriceTier.consumer)
LABEL = {PriceTier.commercial: "تجاري", PriceTier.semi_commercial: "نصف تجاري",
         PriceTier.wholesale: "جملة", PriceTier.semi_wholesale: "نصف جملة",
         PriceTier.consumer: "مستهلك"}


def run(*, branch_name: str, fallback: PriceTier, execute: bool) -> None:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{branch_name}»")
        customers = db.scalars(select(Customer).where(
            Customer.branch_id == branch.id, Customer.default_price_tier.is_(None),
            Customer.customer_type != "plumber")).all()
        prices: dict[int, dict[PriceTier, object]] = {}
        for p in db.scalars(select(ItemPrice)).all():
            prices.setdefault(p.item_id, {})[p.tier] = p.price
        plan = []
        summary: Counter = Counter()
        for c in customers:
            lines = db.execute(
                select(SalesInvoiceLine.item_id, SalesInvoiceLine.unit_price)
                .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
                .where(SalesInvoice.customer_id == c.id)).all()
            votes: Counter = Counter()
            for item_id, price in lines:
                for tier, value in prices.get(item_id, {}).items():
                    if value is not None and price is not None and value == price:
                        votes[tier] += 1
            best = max(ORDER, key=lambda t: (votes[t], -ORDER.index(t))) if votes else fallback
            plan.append((c, best, sum(votes.values()), len(lines)))
            summary[best] += 1
        for c, tier, hits, n in plan[:15]:
            print(f"{c.name:<40} {LABEL[tier]:<10} (سطور: {n}، مطابقة: {hits})")
        print("الإجمالي:", "، ".join(f"{LABEL[t]}: {summary[t]}" for t in ORDER if summary[t]))
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for c, tier, _, _ in plan:
            c.default_price_tier = tier
            audit_service.record(db, action="customer.set_price_tier", actor_user_id=None,
                                 entity_type="customer", entity_id=c.id,
                                 before={"default_price_tier": None},
                                 after={"default_price_tier": tier.value})
        db.commit()
        print(f"تم: {len(plan)} عميل")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تحديد فئة السعر لعملاء فرع من فواتيرهم السابقة")
    ap.add_argument("--branch", required=True)
    ap.add_argument("--fallback", default="commercial", choices=[t.value for t in ORDER])
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(branch_name=a.branch, fallback=PriceTier(a.fallback), execute=a.yes)


if __name__ == "__main__":
    main()
