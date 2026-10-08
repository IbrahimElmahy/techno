from __future__ import annotations

import os
import sys
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.lib.arabic import bare
from src.models.customer import Customer
from src.models.org import Branch
from src.models.supplier import Supplier
from src.scripts.import_a5 import JUNK, _clean, _read


def _sheet(folder: str) -> list[tuple[str, str, str, str]]:
    out: list[tuple[str, str, str, str]] = []
    for r in _read(os.path.join(folder, "a5_misc.tsv")):
        if not r or r[0] != "SUPP":
            continue
        a5_id = _clean(r[1] if len(r) > 1 else "")
        name = _clean(r[2] if len(r) > 2 else "")
        if not a5_id or not name or JUNK.match(name):
            continue
        out.append((a5_id, name, _clean(r[3] if len(r) > 3 else ""),
                    _clean(r[4] if len(r) > 4 else "")))
    return out


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    rows = _sheet(folder)
    if not rows:
        print(f"مافيش صفوف SUPP في `{folder}/a5_misc.tsv` — اتأكد من مجلد التصدير.")
        return 2

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None:
            print(f"الفرع «{branch_name}» مش موجود.")
            return 2

        have = {s.code: s for s in db.scalars(
            select(Supplier).where(Supplier.code.startswith(f"{prefix}A5-"))).all() if s.code}

        by_bare: dict[str, list[str]] = defaultdict(list)
        for a5_id, name, _ph, _ad in rows:
            by_bare[bare(name)].append(a5_id)

        missing: list[tuple[str, str, str, str]] = []
        foreign: list[tuple[str, str, int | None]] = []
        for a5_id, name, phone, address in rows:
            code = f"{prefix}A5-{a5_id}"
            hit = have.get(code)
            if hit is not None:
                if hit.branch_id is not None and hit.branch_id != branch.id:
                    foreign.append((code, hit.name, hit.branch_id))
                continue
            missing.append((a5_id, name, phone, address))

        invented: list[tuple[str, str, str, str]] = []
        ambiguous: list[tuple[str, str, str]] = []
        for label, model in (("مورد", Supplier), ("عميل", Customer)):
            scan = select(model).where(
                model.code.startswith(f"{prefix}A5X"),
                model.branch_id == branch.id,
            )
            for row in db.scalars(scan).all():
                hits = by_bare.get(bare(row.name or ""), [])
                if len(hits) == 1:
                    invented.append((label, row.code, row.name, hits[0]))
                elif len(hits) > 1:
                    ambiguous.append((label, row.code, row.name))

        print(f"كشف موردين a5: {len(rows)} مورد   (الفرع: {branch.name}"
              + (f" · البادئة: {prefix}" if prefix else "") + ")")
        print(f"موجود عندنا بالكود الحقيقي: {len(rows) - len(missing)}")
        print(f"ناقص: {len(missing)}\n")

        for a5_id, name, phone, address in missing[:40]:
            tail = " · ".join(x for x in (phone, address[:40]) if x)
            print(f"   {prefix}A5-{a5_id:<8} {name}" + (f"   [{tail}]" if tail else ""))
        if len(missing) > 40:
            print(f"   … و{len(missing) - 40} غيرهم")

        if foreign:
            print(f"\nأكواد موجودة على فرع تاني — اتساب ومااتلمسش ({len(foreign)}):")
            for code, name, other in foreign:
                print(f"   {code:<14} «{name}»  ⇦  فرع رقم {other}")

        if invented or ambiguous:
            print("\nكروت مخترعة ليها أصل في كشف الموردين")
            print("(اتعملت من الفواتير بكود A5X — الدمج قرارك إنت، السكربت مابيلمسهاش)")
            for label, code, name, a5_id in sorted(invented, key=lambda x: x[1]):
                print(f"   {label:<5} {code:<12} «{name}»  ⇦  المورد رقم {a5_id}"
                      f" ({prefix}A5-{a5_id})")
            for label, code, name in sorted(ambiguous, key=lambda x: x[1]):
                print(f"   {label:<5} {code:<12} «{name}»  ⇦  أكتر من مورد بنفس الاسم"
                      " — محتاج مراجعة بالإيد")

        if not missing:
            print("\nكل موردين الكشف موجودين — مافيش حاجة تتعمل.")
            return 0
        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            return 0

        for a5_id, name, phone, address in missing:
            db.add(Supplier(
                code=f"{prefix}A5-{a5_id}", name=name,
                phone=phone[:32] or None, address=address[:240] or None,
                branch_id=branch.id, active=True))
        db.commit()
        print(f"\nاتعمل {len(missing)} مورد.")
        print("شغّل `link_a5_party_accounts` بعده عشان يتربطوا بحساباتهم في الشجرة.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    if not branch:
        print("لازم --branch (اسم الفرع اللي الموردين يتبعوه).")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in args))
