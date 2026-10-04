"""كارت مورد لكل فرع لموردين أكتوبر اللي الفروع التانية بتستعملهم (٢٠٢٦-١٠-٠٤).

الفصل بين الفروع بيرفض مستند فرع بمورد فرع تاني. «@@ مورد نقدى» و«ايجارات» كارتهم على
أكتوبر وبيتستعملوا في شرا السادات والعلياء — فكل فرع بياخد كارت لوحده بحسابه هو (رصيد
منفصل)، بنفس طريقة إضافة مورد من الشاشة. القديم بيفضل زي ما هو على أكتوبر، وفواتيره
القديمة مابتتلمسش (التعديل اللي مابيغيّرش المورد بيعدّي).

عرض فقط افتراضياً؛ `--yes` للتنفيذ. بيتخطّى أي فرع عنده الكارت خلاص (نفس الاسم + الفرع).

    python -m src.scripts.branch_supplier_copies
    python -m src.scripts.branch_supplier_copies --yes
"""
from __future__ import annotations

import argparse

from sqlalchemy import select

from src.core.db import SessionLocal
from src.services.numbering import next_document_number
from src.models.ledger import Account, AccountType, Direction
from src.models.org import Branch
from src.models.supplier import Supplier, SupplierAccount

SOURCE_IDS = (1, 4)          # «@@ مورد نقدى»، «ايجارات» — على أكتوبر


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}
        planned: list[tuple[Supplier, int, str]] = []
        for sid in SOURCE_IDS:
            src = db.get(Supplier, sid)
            if src is None:
                print(f"المورد #{sid} مش موجود — اتخطّى")
                continue
            for bid, bname in branches.items():
                if bid == src.branch_id:
                    continue
                name = f"{src.name} — {bname}"
                exists = db.scalar(select(Supplier.id).where(
                    Supplier.branch_id == bid, Supplier.name.in_([src.name, name])))
                if exists:
                    print(f"  «{src.name}» عند {bname} موجود خلاص (#{exists}) — اتخطّى")
                    continue
                planned.append((src, bid, name))

        for src, bid, name in planned:
            print(f"  + «{name}» (فرع {branches[bid]}) — نسخة من #{src.id} «{src.name}»")
        if not args.yes:
            print(f"\nعرض فقط — {len(planned)} كارت. أضف --yes للتنفيذ.")
            return

        for src, bid, name in planned:
            code = next_document_number(db, Supplier, "SUP", column=Supplier.code, width=5)
            acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit)
            db.add(acc)
            db.flush()
            s = Supplier(code=code, name=name, branch_id=bid, phone=src.phone, address=src.address,
                         supplier_type=src.supplier_type, is_cash=src.is_cash, active=True)
            db.add(s)
            db.flush()
            sa = SupplierAccount(supplier_id=s.id, account_id=acc.id)
            db.add(sa)
            db.flush()
            acc.owner_ref = sa.id
            print(f"  ✓ #{s.id} {code} «{name}»")
        db.commit()
        print(f"\n✓ اتعمل {len(planned)} كارت.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
