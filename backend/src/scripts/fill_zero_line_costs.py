from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.org import Branch
from src.models.sales import SalesInvoice, SalesInvoiceLine
from src.services import audit_service, costing_service


def run(*, branch_name: str, since: str, execute: bool) -> None:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{branch_name}»")
        rows = db.execute(
            select(SalesInvoiceLine, SalesInvoice.document_number, SalesInvoice.created_at)
            .join(SalesInvoice, SalesInvoice.id == SalesInvoiceLine.invoice_id)
            .where(SalesInvoice.branch_id == branch.id, SalesInvoice.created_at >= since,
                   (SalesInvoiceLine.unit_cost.is_(None)) | (SalesInvoiceLine.unit_cost == 0))
            .order_by(SalesInvoice.id)).all()
        fixed = []
        for line, number, created in rows:
            base = costing_service.known_cost(db, line.item_id, as_of=created.date())
            if not base:
                continue
            cost = to_money(Decimal(str(base)) * Decimal(str(line.unit_factor or 1)))
            fixed.append((line, number, cost))
            print(f"{number}  صنف {line.item_id}  كمية {line.quantity}  سعر {line.unit_price}  تكلفة 0 ← {cost}")
        print(f"سطور تكلفتها صفر: {len(rows)} · هتتصلّح: {len(fixed)}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for line, number, cost in fixed:
            audit_service.record(db, action="sales_line.fill_zero_cost", actor_user_id=None,
                                 entity_type="sales_invoice_line", entity_id=line.id,
                                 before={"unit_cost": "0", "document": number},
                                 after={"unit_cost": str(cost)})
            line.unit_cost = cost
        db.commit()
        print(f"تم: {len(fixed)} سطر")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تكلفة سطور البيع اللي اتسجلت بصفر، من تكلفة يوم الفاتورة")
    ap.add_argument("--branch", required=True)
    ap.add_argument("--since", default="2026-01-01")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(branch_name=a.branch, since=a.since, execute=a.yes)


if __name__ == "__main__":
    main()
