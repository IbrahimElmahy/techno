"""يصلّح فروقات كشوف العملاء ضد a5 — الشارد والمقسّم والمعدّل رجعياً.

    python -m src.scripts.fix_stale_vouchers          # يعرض بس
    python -m src.scripts.fix_stale_vouchers --yes    # ينفّذ

**اللي اتقاس (مطابقة سطر-بسطر لـ19,716 قيد بمرجع a5 ضد تصدير اليوم):**

* **قيود شاردة (a5 مسحها رجعياً):** مرتجعان (18094/18994) اتسجّلا عند a5 مرتين
  بنفس رقم المردود (9230/9255) ثم اتشال القديم، و4 سندات يومية (4909/4910/4911
  بقيمة 592 ألف + 19164 بقيمة 24.5 ألف) اتلغت من a5. عندنا لسه موجودين.
  المسح مع إعادة ربط مستندات المرتجع على القيود الباقية (نفس الـOrdBk).
* **مبالغ اتعدّلت (نفس السطور):** قيدان (4372/4822) a5 غيّر مبالغهما بنفس
  الـsysfree (11.25 و389.25). التحديث على نفس الحسابات والاتجاهات.
* **قيد متقسّم (17578):** a5 قسّم مدين العميل 13,970.22 إلى (عميل 10,970.22 +
  خصم مسموح به 2057 بقيمة 3,000). عندنا النسخة القديمة المدمجة. الإصلاح:
  تصحيح سطر العميل + إضافة سطر الخصم (الحساب موجود).
* **حسابات شجرة جديدة ناقصة:** a5 فتح فروعاً جديدة (4351/4352/4353 عملاء وخصم،
  3302 خصم أكتوبر) والمستورد تخطّى سطورها («حساب مش موجود») فساب 4 قيود ناقصة
  (منها قيد أحادي الطرف). الإصلاح: فتح الحسابات (نفس مجموعاتها) + استكمال السطور.

**الحرّاس:** كل حالة بتتعاد قياسها قبل الكتابة (السطور الحالية تطابق المتوقع
بالحرف) وأي اختلاف بيوقف الكل قبل أي كتابة. وبيتعاد تشغيله بأمان.
"""
from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, AccountNature, Direction, LedgerEntry, LedgerLine
from src.models.org import Branch
from src.models.sales import SalesReturn

ZERO = Decimal("0")


def _legs(db, entry):
    accs = {a.id: a.code for a in db.scalars(select(Account)).all()}
    return sorted((accs.get(ln.account_id), str(ln.direction).split(".")[-1], Decimal(ln.amount))
                  for ln in db.scalars(select(LedgerLine).where(LedgerLine.entry_id == entry.id)).all())


def _get(db, eid, ref, etype):
    e = db.get(LedgerEntry, eid)
    assert e is not None and e.external_ref == ref and e.entry_type == etype, (eid, ref)
    return e


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        acc_by_code = {a.code: a for a in db.scalars(select(Account)).all() if a.code}
        problems: list[str] = []

        # ---------- 1. الشارد: تحقق ----------
        stale_ids = [18094, 18994, 4909, 4910, 4911, 19164]
        stale_refs = {18094: "a5:AL-112309", 18994: "a5:AL-113630", 4909: "a5:40267",
                      4910: "a5:40269", 4911: "a5:40270", 19164: "a5:AL-114802"}
        for eid, ref in stale_refs.items():
            e = db.get(LedgerEntry, eid)
            if e is None:
                problems.append(f"stale {eid}: مش موجود أصلاً (اتمسح قبل كده؟)")
                continue
            if e.external_ref != ref:
                problems.append(f"stale {eid}: مرجعه اتغيّر ({e.external_ref})")
        # المرتجعات: الباقي موجود وبنفس الـOrdBk، والمستند مربوط على الشارد
        surv = {18094: 19180, 18994: 19181}
        for old, new in surv.items():
            for eid in (old, new):
                if db.get(LedgerEntry, eid) is None:
                    problems.append(f"swap {old}->{new}: القيد {eid} مش موجود")
        doclink = {}
        for docno, old in (("AL-SR9230", 18094), ("AL-SR9255", 18994)):
            r = db.scalar(select(SalesReturn).where(SalesReturn.document_number == docno))
            if r is None or r.ledger_entry_id != old:
                problems.append(f"link {docno}: مش مربوط على {old} زي المتوقع")

        # ---------- 2. المبالغ: تحقق ----------
        amt_fixes = {4372: [("A5S-3", "credit", "7017.48"), ("A5S-681", "debit", "7017.48")],
                     4822: [("A5S-3", "credit", "3114.00"), ("A5S-3293", "debit", "3114.00")]}
        for eid, want in amt_fixes.items():
            e = db.get(LedgerEntry, eid)
            if e is None:
                problems.append(f"amt {eid}: مش موجود")
                continue
            got = [(c, d) for c, d, _a in _legs(db, e)]
            if got != [(c, d) for c, d, _a in want]:
                problems.append(f"amt {eid}: هيكل السطور اتغيّر {got}")

        # ---------- 3. التقسيم 17578: تحقق ----------
        e = db.get(LedgerEntry, 17578)
        if e is None:
            problems.append("split 17578: مش موجود")
        elif _legs(db, e) != [("AL-A5S-1007", "credit", Decimal("13970.22")),
                              ("AL-A5S-308", "debit", Decimal("13970.22"))]:
            problems.append(f"split 17578: سطوره اتغيّرت {_legs(db, e)}")
        if "AL-A5S-2057" not in acc_by_code:
            problems.append("split 17578: حساب AL-A5S-2057 مش موجود")

        # ---------- 4. الحسابات الناقصة + استكمال السطور: تحقق ----------
        need_accs = [("AL-A5S-4351", "AL-A5M-5"), ("AL-A5S-4352", "AL-A5M-5"),
                     ("AL-A5S-4353", "AL-A5M-11"), ("A5S-3302", "A5M-11")]
        branch_of = {"AL-": "العلياء", "": "أكتوبر"}
        for code, parent_code in need_accs:
            if code in acc_by_code:
                continue
            parent = acc_by_code.get(parent_code)
            if parent is None:
                problems.append(f"backfill: المجموعة {parent_code} مش موجودة")
        backfill = {19320: [("AL-A5S-4351", "credit", "14670.00"), ("AL-A5S-4351", "debit", "14670.00")],
                    19321: [("AL-A5S-4353", "debit", "1879.20")],
                    19322: [("AL-A5S-4352", "credit", "58610.00"), ("AL-A5S-4352", "debit", "58285.43")],
                    19604: [("A5S-3302", "debit", "36.52")]}
        for eid, legs in backfill.items():
            e = db.get(LedgerEntry, eid)
            if e is None:
                problems.append(f"backfill {eid}: مش موجود")
                continue
            have = set((c, d, a) for c, d, a in _legs(db, e))
            for c, d, a in legs:
                if (c, d, Decimal(a)) in have:
                    problems.append(f"backfill {eid}: السطر {c} {d} {a} موجود فعلاً")

        print(f"حالات الفحص: شارد 6 · مبالغ 2 · تقسيم 1 · استكمال 4")
        if problems:
            print(f"\n✘ {len(problems)} مانع — مافيش حاجة اتكتبت:")
            for p in problems:
                print(f"   {p}")
            raise SystemExit(1)

        print("كل الحرّاس عدّت: الشارد موجود بمراجعه · الباقي حي · المستندات مربوطة · "
              "السطور مطابقة للمتوقع · الحسابات (2057) موجودة.")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        # ---------- تنفيذ ----------
        # أ) إعادة الربط ثم مسح الشارد
        for docno, old, new in (("AL-SR9230", 18094, 19180), ("AL-SR9255", 18994, 19181)):
            r = db.scalar(select(SalesReturn).where(SalesReturn.document_number == docno))
            r.ledger_entry_id = new
        for eid in stale_ids:
            e = db.get(LedgerEntry, eid)
            if e is None:
                continue
            for ln in db.scalars(select(LedgerLine).where(LedgerLine.entry_id == eid)).all():
                db.delete(ln)
            db.delete(e)
        # ب) تحديث المبالغ (نفس الحسابات والاتجاهات — المبلغ بس)
        accs = {a.id: a.code for a in db.scalars(select(Account)).all()}
        for eid, want in amt_fixes.items():
            lines = db.scalars(select(LedgerLine).where(LedgerLine.entry_id == eid)).all()
            for ln in lines:
                for c, d, a in want:
                    if accs.get(ln.account_id) == c and str(ln.direction).split(".")[-1] == d:
                        ln.amount = Decimal(a)
        # ج) التقسيم 17578: تصحيح سطر العميل + إضافة سطر الخصم
        accs = {a.id: a.code for a in db.scalars(select(Account)).all()}
        for ln in db.scalars(select(LedgerLine).where(LedgerLine.entry_id == 17578)).all():
            if accs.get(ln.account_id) == "AL-A5S-308":
                ln.amount = Decimal("10970.22")
        db.add(LedgerLine(entry_id=17578, account_id=acc_by_code["AL-A5S-2057"].id,
                          direction=Direction.debit, amount=Decimal("3000.00"),
                          statement="خصم مسموح به (مقسّم من a5)"))
        # د) الحسابات الناقصة + الاستكمال
        for code, parent_code in need_accs:
            if code in acc_by_code:
                continue
            parent = acc_by_code[parent_code]
            prefix = "AL-" if code.startswith("AL-") else ""
            branch = db.scalar(select(Branch).where(Branch.name == branch_of[prefix]))
            acc = Account(account_type=parent.account_type, name=dict(
                [("AL-A5S-4351", "تكنو احمد عبد الله"), ("AL-A5S-4352", "احمد عبد الله"),
                 ("AL-A5S-4353", "تكنو احمد عبد الله"), ("A5S-3302", "عمرو حسين وايت")])[code],
                code=code, nature=parent.nature, normal_side=parent.normal_side,
                parent_id=parent.id, is_postable=True, is_system=False,
                branch_id=branch.id if branch else parent.branch_id, active=True)
            db.add(acc)
            db.flush()
            acc_by_code[code] = acc
        for eid, legs in backfill.items():
            for c, d, a in legs:
                db.add(LedgerLine(entry_id=eid, account_id=acc_by_code[c].id,
                                  direction=(Direction.credit if d == "credit" else Direction.debit),
                                  amount=Decimal(a)))
        db.commit()
        print("\n✔ اتمسح 6 قيود شاردة · اتحدّث قيدان · اتقسّم قيد · اتفتح 4 حسابات واستُكملت 4 قيود.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
