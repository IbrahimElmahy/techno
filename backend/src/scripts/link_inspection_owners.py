from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.inspection import Inspection
from src.services.inspection_service import _bare_name, find_or_create_owner


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rows = db.scalars(
            select(Inspection)
            .where(Inspection.owner_id.is_(None), Inspection.customer_id.is_(None))
            .order_by(Inspection.id)
        ).all()
        counts: Counter = Counter()
        made: list[tuple[str, str | None, str]] = []
        other_name: list[tuple[str, str, str]] = []

        for insp in rows:
            if not _bare_name(insp.owner_name):
                counts["معاينات بلا اسم مالك"] += 1
                continue
            owner, created = find_or_create_owner(
                db, name=insp.owner_name, phone=insp.owner_phone,
                national_id=insp.national_id, address=insp.owner_address,
                floor_number=insp.floor_number, branch_id=insp.branch_id,
                rep_user_id=insp.rep_user_id)
            if owner is None:
                counts["تعذر الربط"] += 1
                continue
            insp.owner_id = owner.id
            if created:
                counts["ملاك جدد"] += 1
                made.append((insp.document_number, owner.phone, owner.name))
            else:
                counts["ربط بمالك موجود"] += 1
                if _bare_name(owner.name) != _bare_name(insp.owner_name):
                    other_name.append((insp.document_number, insp.owner_name, owner.name))
            db.flush()

        print(f"معاينات بلا مالك مرتبط: {len(rows)}")
        for k, v in counts.most_common():
            print(f"   {k:<30}{v:>7}")
        print(f"   {'ربط بالهاتف واسم مختلف':<30}{len(other_name):>7}")

        if made:
            print("\nأمثلة على الملاك الجدد:")
            for doc, phone, name in made[:20]:
                print(f"   {doc:<16}{phone or '-':<14}{name}")
        if other_name:
            print("\nربط بالهاتف واسم مختلف (للمراجعة):")
            for doc, insp_name, owner_name in other_name[:50]:
                print(f"   {doc:<16}{insp_name}  ←  {owner_name}")

        if not execute:
            db.rollback()
            print("\nعرض فقط — لم يُكتب شيء. أضف --yes للتنفيذ.")
            return
        db.commit()
        print("\nتم الحفظ.")
    finally:
        db.close()


def main() -> None:
    run(execute="--yes" in sys.argv[1:])


if __name__ == "__main__":
    main()
