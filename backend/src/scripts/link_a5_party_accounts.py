"""يربط كل عميل ومورد منقول من a5 بحسابه في شجرة الحسابات.

من غير الربط ده الشاشة بتقول إن العميل مايدنش حاجة: رصيده وكشف حسابه بيتقروا من الحساب
المربوط بيه، والفلوس كانت قاعدة على حسابات a5 اللي مافيش حاجة بتشاور عليها — ١٩٦٦ حساب
تحت «العملاء» و٣٩ تحت «الموردون»، وصفر عميل ليه حساب.

    python -m src.scripts.link_a5_party_accounts          # يعرض بس
    python -m src.scripts.link_a5_party_accounts --yes    # ينفّذ

بيتعاد تشغيله بأمان: اللي متربط بيتساب.

---------------------------------------------------------------------------
تلات قرارات:

* **الربط بالاسم لأن ده اللي في الداتا.** a5 مابيربطش العميل بحسابه بمفتاح — الحساب اسمه
  اسم العميل وخلاص. فالمطابقة على الاسم بعد تطبيع ة/ه وأ/ا وى/ي والمسافات.

* **الملتبس بيتساب مش بيتخمّن.** لو اسمين عملاء بيطابقوا نفس الحساب، أو عميل بيطابق
  حسابين، مافيش ربط — ربط غلط معناه إن مديونية واحد بتظهر على واحد تاني، وده غلط
  مابيتكشفش غير لما حد يطالب بفلوسه.

* **الحساب لازم يكون تحت المجموعة الصح.** «تكنو ثيرم» ممكن يكون عميل ومورد في نفس الوقت،
  والاسم لوحده مابيفرّقش. فالبحث بيتقيّد بأبناء «العملاء» للعملاء و«الموردون» للموردين.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account
from src.models.org import Branch
from src.models.supplier import Supplier, SupplierAccount

CUSTOMER_GROUPS = ("العملاء", "ذمم الموظفين")
SUPPLIER_GROUPS = ("الموردون", "الموردين")


def _norm(s: str) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s or "")
    s = s.replace("ة", "ه").replace("ى", "ي").replace("ـ", "")
    return re.sub(r"\s+", " ", s).strip()


def _accounts_under(db, groups: tuple[str, ...]) -> dict[int | None, dict[str, list[Account]]]:
    """حسابات a5 تحت المجموعات دي، مرتبة بالفرع وبالاسم المتطبّع."""
    parents = {a.id for a in db.scalars(select(Account)).all()
               if (a.name or "").strip() in groups and not a.is_postable}
    out: dict[int | None, dict[str, list[Account]]] = defaultdict(lambda: defaultdict(list))
    for a in db.scalars(select(Account).where(Account.parent_id.in_(parents))).all():
        out[a.branch_id][_norm(a.name or "")].append(a)
    return out


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}
        cust_accounts = _accounts_under(db, CUSTOMER_GROUPS)
        supp_accounts = _accounts_under(db, SUPPLIER_GROUPS)

        linked_c = {a.customer_id for a in db.scalars(select(CustomerAccount)).all()}
        linked_s = {a.supplier_id for a in db.scalars(select(SupplierAccount)).all()}
        used = {a.account_id for a in db.scalars(select(CustomerAccount)).all()}
        used |= {a.account_id for a in db.scalars(select(SupplierAccount)).all()}

        plans: list[tuple[str, object, Account]] = []
        report: dict[str, int] = defaultdict(int)
        unmatched: dict[str, list[str]] = defaultdict(list)

        def resolve(kind, rows, book, already, name_of):
            # نعدّ كام طرف بيطابق كل حساب — الملتبس مابيتربطش من الناحيتين.
            by_key: dict[tuple[int | None, str], int] = defaultdict(int)
            for r in rows:
                by_key[(r.branch_id, _norm(name_of(r)))] += 1
            for r in rows:
                if r.id in already:
                    report[f"{kind}: متربط قبل كده"] += 1
                    continue
                key = _norm(name_of(r))
                hits = [a for a in book.get(r.branch_id, {}).get(key, [])
                        if a.id not in used]
                if not hits:
                    report[f"{kind}: مالوش حساب في الشجرة"] += 1
                    unmatched[kind].append(name_of(r))
                    continue
                if len(hits) > 1 or by_key[(r.branch_id, key)] > 1:
                    report[f"{kind}: ملتبس — اتساب"] += 1
                    unmatched[kind + " (ملتبس)"].append(name_of(r))
                    continue
                used.add(hits[0].id)
                plans.append((kind, r, hits[0]))
                report[f"{kind}: هيتربط"] += 1

        resolve("عملاء", db.scalars(select(Customer)).all(), cust_accounts,
                linked_c, lambda r: r.name)
        resolve("موردين", db.scalars(select(Supplier)).all(), supp_accounts,
                linked_s, lambda r: r.name)

        print("الحسابات المتاحة في الشجرة:")
        for label, book in (("عملاء", cust_accounts), ("موردين", supp_accounts)):
            total = sum(len(v) for d in book.values() for v in d.values())
            per = ", ".join(f"{branches.get(b, 'بدون فرع')}={sum(len(v) for v in d.values())}"
                            for b, d in book.items())
            print(f"   {label:<8}{total:>6}   ({per})")
        print()
        for k, v in sorted(report.items()):
            print(f"   {k:<34}{v:>6}")
        for kind, names in unmatched.items():
            if not names:
                continue
            print(f"\n{kind} ({len(names)}):")
            for n in names[:10]:
                print("   ", n)
            if len(names) > 10:
                print(f"    … و{len(names) - 10} غيرهم")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        made = 0
        for kind, row, account in plans:
            if kind == "عملاء":
                db.add(CustomerAccount(customer_id=row.id, account_id=account.id))
            else:
                db.add(SupplierAccount(supplier_id=row.id, account_id=account.id))
            made += 1
        db.commit()
        print(f"\nاتربط {made} طرف بحسابه.")
        print("تم.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
