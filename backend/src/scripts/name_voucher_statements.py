from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.ledger import LedgerEntry, LedgerLine
from src.models.supplier import Supplier
from src.models.voucher import Voucher, VoucherKind
from src.services import audit_service

RULES = (
    (VoucherKind.receipt, "customer", "تحصيل من عميل", "تحصيل من العميل {name}"),
    (VoucherKind.payment, "supplier", "دفع لمورد", "دفع للمورد {name}"),
)


def _renamed(text: str | None, old: str, new: str) -> str | None:
    if not text or not text.startswith(old):
        return None
    return new + text[len(old):]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        changed_lines = changed_entries = 0
        samples: list[str] = []
        for kind, party, old, pattern in RULES:
            model = Customer if party == "customer" else Supplier
            column = Voucher.customer_id if party == "customer" else Voucher.supplier_id
            rows = db.execute(
                select(Voucher.ledger_entry_id, model.name)
                .join(model, model.id == column)
                .where(Voucher.kind == kind, Voucher.ledger_entry_id.is_not(None))).all()
            for entry_id, name in rows:
                new = pattern.format(name=name)
                for line in db.scalars(select(LedgerLine).where(
                        LedgerLine.entry_id == entry_id)).all():
                    text = _renamed(line.statement, old, new)
                    if text is not None:
                        if len(samples) < 6:
                            samples.append(f"{line.statement}  ←  {text}")
                        line.statement = text
                        changed_lines += 1
                entry = db.get(LedgerEntry, entry_id)
                text = _renamed(entry.description if entry else None, old, new)
                if text is not None:
                    entry.description = text
                    changed_entries += 1
        for s in samples:
            print(s)
        print(f"سطور هتتعدّل: {changed_lines} · قيود: {changed_entries}")
        if not execute:
            db.rollback()
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        audit_service.record(db, action="voucher.name_statements", actor_user_id=None,
                             entity_type="ledger", entity_id=0,
                             after={"lines": changed_lines, "entries": changed_entries})
        db.commit()
        print("تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="إضافة اسم العميل/المورد لبيان سندات القبض والصرف القديمة")
    ap.add_argument("--yes", action="store_true")
    run(execute=ap.parse_args().yes)


if __name__ == "__main__":
    main()
