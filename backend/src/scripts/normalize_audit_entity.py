# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.core.request_audit import _ENTITY
from src.models.audit import AuditLogEntry


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        counts = dict(db.execute(
            select(AuditLogEntry.entity_type, func.count(AuditLogEntry.id))
            .group_by(AuditLogEntry.entity_type)
        ).all())
        todo = {old: new for old, new in _ENTITY.items()
                if counts.get(old) and old != new}

        print(f"{'الاسم من الرابط':<22} {'صفوف':>6}   ←  {'الاسم الموحّد':<22} {'عنده':>6}")
        for old, new in sorted(todo.items()):
            print(f"{old:<22} {counts[old]:>6}   ←  {new:<22} {counts.get(new, 0):>6}")
        if not todo:
            print()
            print("مافيش حاجة تتغيّر.")
            return
        total = sum(counts[o] for o in todo)
        print()
        print(f"هيتغيّر: {total} صف | الأنواع هتبقى {len(counts) - len(todo)} بدل {len(counts)}")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        before = db.execute(select(
            func.count(AuditLogEntry.id), func.min(AuditLogEntry.created_at),
            func.max(AuditLogEntry.created_at),
            func.count(func.distinct(AuditLogEntry.action)))).first()

        changed = 0
        for old, new in todo.items():
            changed += db.execute(
                update(AuditLogEntry)
                .where(AuditLogEntry.entity_type == old)
                .values(entity_type=new)
            ).rowcount or 0
        db.flush()
        after = db.execute(select(
            func.count(AuditLogEntry.id), func.min(AuditLogEntry.created_at),
            func.max(AuditLogEntry.created_at),
            func.count(func.distinct(AuditLogEntry.action)))).first()
        if before != after:
            db.rollback()
            raise SystemExit(f"اترفض: السجل اتغيّر — قبل {before} بعد {after}")
        db.commit()
        print(f"اتغيّر: {changed} صف")
        print(f"عدد الصفوف والأفعال والمدى: زي ما هم ✔  {after}")
        print()
        for name, n in db.execute(
            select(AuditLogEntry.entity_type, func.count(AuditLogEntry.id))
            .group_by(AuditLogEntry.entity_type)
            .order_by(func.count(AuditLogEntry.id).desc())
        ).all():
            print(f"   {str(name):<24} {n:>5}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
