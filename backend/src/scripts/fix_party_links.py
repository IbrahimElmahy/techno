from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.sales import SalesInvoice, SalesReturn
from src.models.user import User

F_A5, F_REPS, F_PLUMBERS = "wb_a5.tsv", "wb_reps.tsv", "wb_plumbers.tsv"

PLUMBER, TRADER = "plumber", "trader"


def _norm(s: str) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s or "").replace("\xa0", " ")
    return re.sub(r"\s+", "", s).strip()


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش ملف {path} — صدّر صفحات ملف العميل الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def run(folder: str, *, execute: bool) -> None:
    a5_rows = _read(os.path.join(folder, F_A5))
    rep_rows = _read(os.path.join(folder, F_REPS))
    plumb_rows = _read(os.path.join(folder, F_PLUMBERS))

    a5_rep = {r["code"]: r["rep"] for r in a5_rows if r.get("code")}
    erp_rep_name = {r["erp_id"]: r["erp_name"] for r in rep_rows if r.get("erp_id")}

    print("المصدر (ملف العميل، الصفحات المسمّاة):")
    print(f"   صفحة A5              {len(a5_rows):>6} صف")
    print(f"   صفحة مندوب           {len(rep_rows):>6} صف")
    print(f"   صفحة سباك            {len(plumb_rows):>6} صف")

    db = SessionLocal()
    try:
        users = db.scalars(select(User)).all()
        user_by_name: dict[str, User] = {}
        for u in users:
            key = _norm(u.full_name or "")
            if key and key not in user_by_name:
                user_by_name[key] = u

        custs = db.scalars(select(Customer)).all()
        by_code = {c.code: c for c in custs if c.code}

        sold = set(db.scalars(select(SalesInvoice.customer_id)).all())
        sold |= set(db.scalars(select(SalesReturn.customer_id)).all())

        plan: list[tuple[Customer, str, object, str]] = []
        notes: Counter = Counter()
        problems: list[str] = []

        for code, rep_name in a5_rep.items():
            c = by_code.get(code)
            if c is None:
                notes["كارت a5 مش عندنا"] += 1
                continue
            ours = _norm((c.rep.full_name if getattr(c, "rep", None) else "")
                         or (db.get(User, c.rep_id).full_name if c.rep_id else ""))
            if ours == _norm(rep_name):
                notes["كارت a5 مندوبه مطابق"] += 1
            else:
                notes["كارت a5 مندوبه مختلف"] += 1
                problems.append(f"{code} «{c.name}»: عندنا «{ours}» والشيت «{rep_name}»")
            if c.customer_type == PLUMBER:
                plan.append((c, "customer_type", TRADER, f"صفحة A5 بتقول تاجر ({code})"))

        seen_plumb: set[str] = set()
        for r in plumb_rows:
            code = f"ERP-P-{r['code']}"
            seen_plumb.add(code)
            c = by_code.get(code)
            if c is None:
                notes["صف في شيت السباك ومالوش كارت عندنا"] += 1
                continue
            kind = r.get("kind", "")
            a5code = r.get("a5_code", "")

            if kind == "تاجر" and a5code in a5_rep:
                twin = by_code.get(a5code)
                rep_user = user_by_name.get(_norm(a5_rep[a5code]))
                if rep_user is None:
                    problems.append(f"{code}: مندوب «{a5_rep[a5code]}» مالوش يوزر — اتخطّى")
                    continue
                if twin is not None and twin.id != c.id:
                    problems.append(
                        f"{code} «{c.name}»: تاجر بكود {a5code} وكارت a5 موجود كمان "
                        f"(#{twin.id}) — تكرار محتاج دمج، اتخطّى")
                    continue
                if c.customer_type != TRADER:
                    plan.append((c, "customer_type", TRADER, f"شيت السباك: تاجر ({a5code})"))
                if c.rep_id != rep_user.id:
                    plan.append((c, "rep_id", rep_user.id,
                                 f"مندوب a5 بتاع {a5code}: {rep_user.full_name}"))
                continue

            if c.rep_id is not None:
                if c.id in sold:
                    problems.append(f"{code} «{c.name}»: سباك بس عليه مستند بيع — اتساب")
                else:
                    plan.append((c, "rep_id", None, "سباك — مافيش مندوب بيع"))
            svc = erp_rep_name.get(r.get("svc_rep", ""))
            su = user_by_name.get(_norm(svc)) if svc else None
            if su is not None and c.service_rep_id != su.id:
                plan.append((c, "service_rep_id", su.id, f"مندوب خدمة: {su.full_name}"))
            elif svc and su is None:
                notes[f"مندوب خدمة مالوش يوزر: {svc}"] += 1

        extra: list[Customer] = []
        for c in custs:
            if not c.code or not c.code.startswith("ERP-"):
                continue
            if c.code in seen_plumb:
                continue
            if c.customer_type != PLUMBER:
                notes[f"اتعدّى: {c.code.split('-')[1]} {c.customer_type}"] += 1
                continue
            extra.append(c)
            if c.rep_id is not None:
                if c.id in sold:
                    problems.append(f"{c.code} «{c.name}»: سباك عليه مستند بيع — اتساب")
                else:
                    plan.append((c, "rep_id", None, "سباك مش في شيت العميل"))

        print("\nالفحص:")
        for k, v in notes.most_common():
            print(f"   {k:<44}{v:>6}")
        print(f"   {'كروت سباك مش في شيت العميل':<44}{len(extra):>6}")

        fields = Counter(f for _, f, _, _ in plan)
        print("\nالخطة:")
        for f, n in fields.most_common():
            print(f"   {f:<44}{n:>6}")
        print(f"   {'إجمالي التعديلات':<44}{len(plan):>6}")

        before = Counter()
        for c in custs:
            if c.rep_id:
                before[c.rep_id] += 1
        after = Counter(before)
        for c, f, v, _ in plan:
            if f != "rep_id":
                continue
            if c.rep_id:
                after[c.rep_id] -= 1
            if v:
                after[v] += 1
        name_of = {u.id: u.full_name for u in users}
        print(f"\n{'المندوب':<30}{'قبل':>8}{'بعد':>8}")
        print("-" * 46)
        for uid, n in before.most_common():
            if n != after[uid]:
                print(f"{str(name_of.get(uid))[:28]:<30}{n:>8}{after[uid]:>8}")

        if problems:
            print(f"\nمحتاج مراجعة ({len(problems)}):")
            for p in problems[:25]:
                print("   ", p)
            if len(problems) > 25:
                print(f"    … و{len(problems) - 25} غيرهم")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, field, value, _ in plan:
            setattr(c, field, value)
        db.commit()
        print(f"\nاتنفّذ: {len(plan)} تعديل على {len({c.id for c, *_ in plan})} كارت.")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = "C:/pgtmp/erp/wb"
    if "--dir" in args:
        folder = args[args.index("--dir") + 1]
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
