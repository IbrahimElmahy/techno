from __future__ import annotations

import os
import sys
from collections import Counter

from sqlalchemy import inspect, select

from src.core.db import SessionLocal, engine
from src.models.customer import Customer, CustomerExternalRef

(B_CODE, B_DIST, B_MERCH, B_A5, B_NAME, B_PHONE, B_COUP, B_VIS) = range(8)

FILENAME = "merchant_bridge.tsv"


def _read_tsv(path: str) -> list[list[str]]:
    if not os.path.exists(path):
        raise SystemExit("مافيش ملف الجسر: " + path)
    rows: list[list[str]] = []
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            if i == 0 or not line.strip():
                continue
            rows.append([c.strip() for c in line.rstrip("\n").split("\t")])
    return rows


def _n(v: str) -> int:
    try:
        return int(v or 0)
    except ValueError:
        return 0


def run(folder: str, *, execute: bool) -> None:
    rows = [r for r in _read_tsv(os.path.join(folder, FILENAME)) if len(r) >= 8]

    db = SessionLocal()
    try:
        table = CustomerExternalRef.__tablename__
        exists = inspect(engine).has_table(table)
        if not exists and execute:
            CustomerExternalRef.__table__.create(bind=engine)
            exists = True
            print("اتعمل جدول `customer_external_ref`.\n")
        elif not exists:
            print("⚠ جدول `customer_external_ref` لسه مااتعملش — هيتعمل مع التنفيذ.\n")

        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        have = {x.ref: x for x in db.scalars(select(CustomerExternalRef)).all()} \
            if exists else {}

        counts: Counter[str] = Counter()
        wanted: list[tuple[str, Customer, str]] = []
        no_a5: list[list[str]] = []
        no_card: list[list[str]] = []
        conflicts: list[str] = []
        folded: dict[str, list[list[str]]] = {}

        for r in rows:
            a5 = r[B_A5]
            if not a5:
                no_a5.append(r)
                continue
            target = by_code.get(a5)
            if target is None:
                no_card.append(r)
                continue
            folded.setdefault(a5, []).append(r)
            for prefix, value in (("ERP-D", r[B_DIST]), ("ERP-M", r[B_MERCH])):
                if not value:
                    continue
                ref = f"{prefix}-{value}"
                old = have.get(ref)
                if old is None:
                    wanted.append((ref, target, r[B_NAME]))
                    counts["ربط جديد"] += 1
                elif old.customer_id == target.id:
                    counts["مربوط قبل كده"] += 1
                else:
                    was = db.get(Customer, old.customer_id)
                    conflicts.append(
                        f"{ref} «{r[B_NAME]}» مربوط بـ«{was.name if was else '؟'}» "
                        f"({was.code if was else '؟'}) والملف بيقول «{target.name}» ({a5})")

        multi = {a5: rs for a5, rs in folded.items() if len(rs) > 1}
        matched = sum(len(v) for v in folded.values())

        print("الجسر:")
        print(f"   صفوف الملف              {len(rows):>6}")
        print(f"   منها بكود a5            {len(rows) - len(no_a5):>6}")
        print(f"   لاقت كارت عندنا         {matched:>6}   على {len(folded)} كارت")
        print(f"   كارت بيلمّ أكتر من واحد  {len(multi):>6}")
        print()
        print(f"   {'ربط جديد':<20}{counts['ربط جديد']:>6}")
        print(f"   {'مربوط قبل كده':<20}{counts['مربوط قبل كده']:>6}")
        print(f"   {'متعارض':<20}{len(conflicts):>6}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        else:
            for ref, target, name in wanted:
                db.add(CustomerExternalRef(system="erp", ref=ref, customer_id=target.id,
                                           source_name=name or None))
            db.commit()
            now = {x.ref: x.customer_id for x in db.scalars(select(CustomerExternalRef)).all()}
            bad = [ref for ref, target, _name in wanted if now.get(ref) != target.id]
            print(f"\nاتكتب {len(wanted)} مفتاح — الإجمالي في الجدول {len(now)}.")
            print("✔ كل مفتاح على كارته." if not bad
                  else f"✘ {len(bad)} مفتاح مالحقش يتربط: {bad[:5]}")

        if conflicts:
            print(f"\nمتعارض — مااتغيّرش، محتاج قرار ({len(conflicts)}):")
            for line in conflicts:
                print("   ", line)

        if no_card:
            print(f"\nكود a5 مكتوب في الورقة ومافيش كارت بيه في الكشف ({len(no_card)}):")
            print(f"   {'كود a5':<12}{'كود التاجر':<12}{'كوبونات':>8}{'معاينات':>8}  الاسم")
            for r in sorted(no_card, key=lambda x: -(_n(x[B_COUP]) + _n(x[B_VIS]))):
                print(f"   {r[B_A5]:<12}{r[B_CODE]:<12}{r[B_COUP]:>8}{r[B_VIS]:>8}"
                      f"  «{r[B_NAME]}»")

        if no_a5:
            print(f"\nتاجر في النظام القديم من غير كود a5 في الورقة ({len(no_a5)}):")
            print(f"   {'كود التاجر':<12}{'كوبونات':>8}{'معاينات':>8}  الاسم")
            for r in sorted(no_a5, key=lambda x: -(_n(x[B_COUP]) + _n(x[B_VIS]))):
                print(f"   {r[B_CODE]:<12}{r[B_COUP]:>8}{r[B_VIS]:>8}  «{r[B_NAME]}»")

        if multi:
            print(f"\nكارت عندنا بيلمّ أكتر من كارت قديم ({len(multi)}) — الدمج مقصود من "
                  "المكتب، والمستندات بتتجمّع عليه:")
            for a5, rs in sorted(multi.items()):
                print(f"   {a5:<12}«{by_code[a5].name}»")
                for r in rs:
                    print(f"      كود {r[B_CODE]:<11}كوبونات {r[B_COUP]:>5}   "
                          f"معاينات {r[B_VIS]:>5}   «{r[B_NAME]}»")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    target_dir = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/erp"
    run(target_dir, execute="--yes" in args)
