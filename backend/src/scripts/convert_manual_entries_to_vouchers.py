from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Direction, LedgerEntry, LedgerLine
from src.models.role import Role
from src.models.treasury import Treasury
from src.models.user import User
from src.models.voucher import Voucher
from src.services import audit_service, voucher_service
from src.services.document_edit_service import _drop_entry


def _plan(db, entry_id: int) -> dict:
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise SystemExit(f"{entry_id}: القيد غير موجود")
    if entry.entry_type != "journal":
        raise SystemExit(f"{entry_id}: ليس قيداً يدوياً ({entry.entry_type})")
    if db.scalar(select(Voucher.id).where(Voucher.ledger_entry_id == entry_id)):
        raise SystemExit(f"{entry_id}: مرتبط بسند")
    lines = db.scalars(select(LedgerLine).where(LedgerLine.entry_id == entry_id)).all()
    if len(lines) != 2:
        raise SystemExit(f"{entry_id}: عدد السطور {len(lines)}")
    safes = {t.account_id: t for t in db.scalars(select(Treasury)).all()}
    cash = [ln for ln in lines if ln.account_id in safes]
    other = [ln for ln in lines if ln.account_id not in safes]
    if len(cash) != 1 or len(other) != 1:
        raise SystemExit(f"{entry_id}: لا يوجد طرف خزينة واحد")
    receipt = cash[0].direction == Direction.debit
    actor = db.get(User, entry.actor_user_id)
    role = db.get(Role, actor.role_id).name
    return {
        "entry": entry, "receipt": receipt, "amount": cash[0].amount,
        "treasury_id": safes[cash[0].account_id].id, "account_id": other[0].account_id,
        "actor_id": actor.id, "role": role,
        "snapshot": [{"account_id": ln.account_id, "direction": ln.direction.value,
                      "amount": str(ln.amount)} for ln in lines],
    }


def run(ids: list[int], execute: bool) -> None:
    db = SessionLocal()
    try:
        plans = [_plan(db, i) for i in ids]
        for p in plans:
            e = p["entry"]
            print(e.id, e.entry_date, e.description, "سند قبض" if p["receipt"] else "سند صرف",
                  p["amount"], "خزينة", p["treasury_id"], "حساب", p["account_id"])
        if not execute:
            print("تجربة فقط — أضف --yes للتنفيذ")
            return
        for p in plans:
            e = p["entry"]
            date, description, entry_id = e.entry_date, e.description, e.id
            _drop_entry(db, entry_id)
            db.flush()
            make = voucher_service.create_receipt if p["receipt"] else voucher_service.create_payment
            v = make(db, account_id=p["account_id"], amount=p["amount"],
                     actor_user_id=p["actor_id"], actor_role=p["role"],
                     treasury_id=p["treasury_id"], voucher_date=date, description=description)
            audit_service.record(
                db, action="ledger_entry.to_voucher", actor_user_id=p["actor_id"],
                entity_type="voucher", entity_id=v.id,
                before={"entry_id": entry_id, "lines": p["snapshot"]},
                after={"doc": v.document_number, "customer_id": v.customer_id,
                       "supplier_id": v.supplier_id})
            print(entry_id, "→", v.document_number, v.customer_id, v.supplier_id)
        db.commit()
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    ids = [int(a) for a in args if a.isdigit()]
    run(ids, execute="--yes" in args)


if __name__ == "__main__":
    main()
