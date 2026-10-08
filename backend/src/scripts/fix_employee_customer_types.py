from __future__ import annotations

import csv
import os
import re
import sys
from collections import defaultdict

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.ledger import Account
from src.models.lookup import LookupOption
from src.models.sales import SalesInvoice

PAYROLL_GROUP = "اجور ومرتبات إدارية"
CUSTODY_GROUP = "ذمم الموظفين"
CUSTOMER_GROUP = "العملاء"

EMPLOYEE_CARDS: dict[str, str] = {
    "AL-A5-984": "احمد صبرى",
    "AL-A5-637": "طارق عقبه",
    "A5-146": "عمرو رجب",
    "AL-A5-3188": "محمود النقراشى",
    "AL-A5-4299": "ابراهيم حسونه",
    "A5-14": "احمد صلاح",
    "AL-A5-152": "محمد صبحى",
    "AL-A5-398": "محمد عزوز",
    "AL-A5-3125": "كامل هلول",
    "A5X2": "محمود عادل المنصورة",
    "A5X3": "كامل هلال",
    "A5X4": "سامى دغار",
    "A5X6": "انس رمضان",
    "A5X7": "احمد دسوقى",
    "A5X8": "محمد سعيد الماحى",
    "A5X10": "عبد الرحمن جمعة",
    "A5X9": "محمود سلام",
    "AL-A5X1": "احمد عسران",
    "AL-A5X5": "محمد حسن",
    "AL-A5X6": "محمد ربيع السقا",
    "AL-A5X7": "مدحت خضر",
    "AL-A5X8": "محمد عسران",
    "AL-A5X9": "حذيفه زين عبد الفتاح",
    "AL-A5X10": "محمد عبد العال فون كاش",
    "AL-A5X11": "محمد مكرم",
    "AL-A5X12": "محمد ممدوح",
    "AL-A5X13": "احمد عبده ناجى هلول",
    "AL-A5X14": "محمد هلال ابو عمه",
    "AL-A5X15": "م سامح هلول",
    "AL-A5X16": "أحمد الشحات",
    "AL-A5X17": "أحمدتركى",
    "AL-A5X18": "محمد عشيبة",
    "AL-A5X19": "ابراهيم حمود",
    "AL-A5X20": "حسام موسي",
    "AL-A5X21": "حسن عيد",
    "AL-A5X22": "احمد منصف زين الدين",
}

BACK_TO_CUSTOMER: dict[str, str] = {
    "AL-A5-781": "احمد صلاح",
    "AL-A5-4357": "محمود سلام",
    "AL-A5-4288": "حسن رمضان",
    "AL-A5-9675": "محمد سعيد",
    "AL-A5-197": "احمد الشحات",
    "AL-A5-667": "مصطفى البحيرى",
}

INTERNAL_CARDS: dict[str, str] = {
    "AL-A5-2112": "خدمة العملاء",
    "AL-A5-187": "اداره مبيعات",
    "A5-1627": "اداره مبيعات",
    "AL-A5X3": "فرع اكتوبر",
}

FLAGGED: dict[str, str] = {}


ROSTER_DIR = "C:/pgtmp"
ROSTER_FILES = ("emp_AL.tsv", "emp_OCT.tsv")

CUST_FILES = {"cust_aliaa2026.tsv": "AL-A5-", "cust_Techno2026.tsv": "A5-"}


def _read_cust() -> dict[str, set[str]] | None:
    out: dict[str, set[str]] = {}
    for fn, prefix in CUST_FILES.items():
        path = os.path.join(ROSTER_DIR, fn)
        if not os.path.exists(path):
            continue
        ids = out.setdefault(prefix, set())
        with open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if (row.get("رقم") or "").strip():
                    ids.add(row["رقم"].strip())
    return out or None


STAFF_GROUPS = ("ذمم الموظفين", "اجور ومرتبات إدارية")
ACC_FILES = {"acc_aliaa2026.tsv": "AL-", "acc_Techno2026.tsv": ""}


def _read_staff_jobs() -> dict[tuple[str, str], str]:
    out: dict[tuple[str, str], str] = {}
    for fn, prefix in ACC_FILES.items():
        path = os.path.join(ROSTER_DIR, fn)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if (row.get("المجموعة") or "").strip() not in STAFF_GROUPS:
                    continue
                job = (row.get("الوظيفة") or "").strip()
                if job:
                    out.setdefault((prefix, _norm(row.get("الاسم") or "")), job)
    return out


def _job_of(code: str, name: str, jobs: dict[tuple[str, str], str]) -> str | None:
    prefix = "AL-" if (code or "").startswith("AL-") else ""
    return jobs.get((prefix, _norm(name)))


def _in_cust(code: str, ids: dict[str, set[str]] | None) -> bool:
    if ids is None:
        return True
    m = re.match(r"^(AL-)?A5-(\d+)$", code or "")
    if not m:
        return False
    return m.group(2) in ids.get("AL-A5-" if m.group(1) else "A5-", set())


def _read_roster() -> tuple[set[str] | None, dict[str, str]]:
    import csv
    import os

    names: set[str] = set()
    jobs: dict[str, str] = {}
    found = False
    for fn in ROSTER_FILES:
        path = os.path.join(ROSTER_DIR, fn)
        if not os.path.exists(path):
            continue
        found = True
        with open(path, encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if (row.get("في_كشف_العملاء") or "").strip() == "0":
                    k = _norm(row.get("الاسم") or "")
                    names.add(k)
                    if (row.get("الوظيفة") or "").strip():
                        jobs[k] = row["الوظيفة"].strip()
    return (names if found else None), jobs


def _norm(s: str) -> str:
    s = (s or "").replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    return re.sub(r"\s+", " ", s).strip()


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        groups = {a.id: (a.name or "").strip()
                  for a in db.scalars(select(Account)) if not a.is_postable}
        in_group: dict[str, set[str]] = defaultdict(set)
        for a in db.scalars(select(Account).where(Account.is_postable.is_(True))):
            in_group[groups.get(a.parent_id, "—")].add(_norm(a.name or ""))
        payroll = in_group.get(PAYROLL_GROUP, set())
        custody = in_group.get(CUSTODY_GROUP, set())
        roster, jobs = _read_roster()
        staff_jobs = _read_staff_jobs()
        jobs = {**{k[1]: v for k, v in staff_jobs.items()}, **jobs}
        cust_ids = _read_cust()
        warned_no_roster = False
        print(f"أسماء تحت «{PAYROLL_GROUP}»: {len(payroll)}   ·   "
              f"تحت «{CUSTODY_GROUP}»: {len(custody)}\n")

        plan: list[tuple[Customer, str, int, bool]] = []
        problems: list[str] = []
        wanted: list[tuple[str, str, str]] = (
            [(c, n, "employee") for c, n in EMPLOYEE_CARDS.items()]
            + [(c, n, "internal") for c, n in INTERNAL_CARDS.items()]
            + [(c, n, "trader") for c, n in BACK_TO_CUSTOMER.items()])
        for code, expect_name, want in wanted:
            c = db.scalar(select(Customer).where(Customer.code == code))
            if c is None:
                problems.append(f"{code} «{expect_name}»: الكارت مش موجود")
                continue
            if _norm(c.name) != _norm(expect_name):
                problems.append(f"{code}: الاسم بقى «{c.name}» بدل «{expect_name}» — اتخطّى")
                continue
            if roster is None:
                if not warned_no_roster:
                    print("⚠️ كشف a5 مش موجود على الجهاز — الحارس متعطّل. "
                          "شغّل الاستعلام وحطّ الكشفين في " + ROSTER_DIR)
                    warned_no_roster = True
            elif want == "employee" and _norm(c.name) not in roster \
                    and not _job_of(code, c.name, staff_jobs):
                problems.append(
                    f"{code} «{c.name}»: لا في كشف موظفي a5 ولا ليه وظيفة — اتخطّى")
                continue
            elif want == "trader" and _job_of(code, c.name, staff_jobs):
                problems.append(
                    f"{code} «{c.name}»: a5 كاتب له وظيفة "
                    f"«{_job_of(code, c.name, staff_jobs)}» — اتخطّى")
                continue
            elif want == "trader" and not _in_cust(code, cust_ids):
                problems.append(
                    f"{code} «{c.name}»: كوده مش في كشف عملاء a5 — اتخطّى")
                continue
            if c.customer_type == want:
                continue
            n = db.scalar(select(func.count()).select_from(SalesInvoice)
                          .where(SalesInvoice.customer_id == c.id)) or 0
            plan.append((c, want, n, _norm(c.name) in custody))

        print(f"{'الكود':<13}{'الاسم':<26}{'من':<11}{'إلى':<11}{'فواتير':>7}{'عهدة'}")
        print("-" * 76)
        for c, want, n, _has in sorted(plan, key=lambda r: (r[1], -r[2])):
            job = jobs.get(_norm(c.name), "")
            print(f"{(c.code or ''):<13}{(c.name or '')[:24]:<26}"
                  f"{str(c.customer_type):<11}{want:<11}{n:>7}  {job}")
        emp_n = sum(1 for _c, w, _n, _h in plan if w == "employee")
        int_n = sum(1 for _c, w, _n, _h in plan if w == "internal")
        back_n = sum(1 for _c, w, _n, _h in plan if w == "trader")
        print(f"\n«موظف»: {emp_n}   ·   «داخلي»: {int_n}   ·   "
              f"راجعين «تاجر» (عندهم حساب عملاء في a5): {back_n}")

        if FLAGGED:
            print("\n⚠️ بيتقالوا ومابيتغيّروش — محتاجين قرار:")
            for code, why in FLAGGED.items():
                c = db.scalar(select(Customer).where(Customer.code == code))
                if c is not None:
                    print(f"   {code:<12}{why}   (دلوقتي «{c.customer_type}»)")

        known = (set(EMPLOYEE_CARDS) | set(INTERNAL_CARDS)
                 | set(FLAGGED) | set(BACK_TO_CUSTOMER))
        missed = [c for c in db.scalars(select(Customer).where(Customer.active.is_(True)))
                  if roster is not None and _norm(c.name) in roster
                  and c.code not in known
                  and c.customer_type not in ("employee", "internal")]
        if missed:
            print(f"\n⚠️ في كشف موظفي a5 ومش في الخريطة ({len(missed)}):")
            for c in missed:
                print(f"   {c.code:<13}{c.name}   («{c.customer_type}»)  "
                      f"{jobs.get(_norm(c.name), '')}")

        if problems:
            print(f"\n⚠️ مش هيتغيّروا ({len(problems)}):")
            for p in problems:
                print(f"   {p}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for value, label in (("employee", "موظف"), ("internal", "فرع/شركة تابعة")):
            if not db.scalar(select(LookupOption).where(
                    LookupOption.category == "customer_type",
                    LookupOption.value == value)):
                db.add(LookupOption(category="customer_type", value=value,
                                    label=label, active=True))
        for c, want, _n, _h in plan:
            c.customer_type = want
        db.commit()

        print(f"\n✔ اتغيّر تصنيف {len(plan)} كارت.")
        for v in ("employee", "internal", "trader"):
            n = db.scalar(select(func.count()).select_from(Customer)
                          .where(Customer.active.is_(True),
                                 Customer.customer_type == v)) or 0
            print(f"   {v:<12}{n:>6}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
