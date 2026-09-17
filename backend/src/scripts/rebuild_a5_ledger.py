"""القيد اللي اتعدّل في a5 بعد ما نقلناه — يتشال من عندنا ويترجع بسطوره الجديدة.

    python -m src.scripts.rebuild_a5_ledger --dir C:/pgtmp --branch أكتوبر
    python -m src.scripts.rebuild_a5_ledger --dir C:/pgtmp/aliaa --branch العلياء --prefix AL- --yes

**درايَ-رن بالافتراضي.** من غير `--yes` بيقول هيعمل إيه وبيقف.

---------------------------------------------------------------------------
**المشكلة اللي بيحلها.** `import_a5_ledger` بيتخطّى القيد اللي `external_ref` بتاعه موجود،
وده اللي بيخلّيه آمن يتعاد كل ليلة. بس العميل بيعدّل مستنداته في a5 بعد ما ننقلها والقيد
بيتغيّر معاها — والتخطّي بيخلّي نسختنا مجمّدة على اللي كان.

**والنتيجة إن الفاتورة بتقول رقم وكشف الحساب بيقول رقم تاني.** `rebuild_a5_docs` بيعيد
بناء المستند لما يتعدّل فالفاتورة بتتصلّح، ومافيش حاجة كانت بتعيد بناء قيدها. اتقاس على
الإنتاج: `AL-P16398` الفاتورة ٥٩٬٧٣٨٫٧٨ (زي a5 بالحرف) والقيد ٥٩٬٥٢٢٫٦٣ — واللي بيفتح
الفاتورة بيلاقيها مظبوطة وبيفتح كشف الحساب يلاقي رقم تاني، ومالوش أي طريق يعرف مين
الصح. الفرق على الفرعين وقت القياس: ١٧ قيد بـ٣٧٨ ألف جنيه.

**بيتصلّح بالهدم وإعادة البناء، مش بالتصحيح.** التصحيح معناه إننا نقرّر أنهي سطر يتظبط
وبكام، والمصدر قال خلاص: القيد هو ده. فبنشيل نسختنا بالكامل — سطورها — وبنسيب
`import_a5_ledger` يبنيها من أول وجديد. هو نفس الكود اللي بنى الباقي، فمافيش طريق تاني
للبيانات يتصان لوحده.

**والربط بالفاتورة بيتفك قبل الحذف.** `sales_invoice.ledger_entry_id` مفتاح خارجي حقيقي؛
حذف القيد وهو لسه مرتبط = خرق مفتاح. الترتيب هنا هو الإصلاح نفسه مش تنظيم — نفس الغلطة
اللي كانت بتطلّع 500 على حذف إذن التحويل. والتشغيلة اللي بعدها بتربطه تاني (المستورد
مكتوب بيربط اللي `None`)، فسلسلة `a5_sync.ps1` بترتيبها بتصلّح ده لوحدها.

⛔ **ومابيلمسش قيد إحنا عملناه.** بيشتغل على اللي `external_ref` بتاعه بيبدأ بـ`a5:` وبس —
يعني قيد اتنقل من عندهم وموجود في التصدير. سند اتكتب في نظامنا عمره ما يدخل القايمة.
"""
from __future__ import annotations

import sys
from decimal import Decimal

from sqlalchemy import delete as sa_delete
from sqlalchemy import select, update as sa_update

from src.core.db import SessionLocal
from src.models.ledger import Direction, LedgerEntry, LedgerLine
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.scripts.audit_a5_ledger_drift import TOL, theirs

ZERO = Decimal("0")

# المستندات اللي بتشاور على قيد — لازم الإشارة تتفك قبل الحذف.
LINKED = (SalesInvoice, SalesReturn, PurchaseInvoice, PurchaseReturn)


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        src = theirs(folder)
        if not src:
            print(f"مافيش a5_acclines.tsv في {folder} — شغّل التصدير الأول.")
            return 2

        tag = f"a5:{prefix}"
        mine: dict[str, LedgerEntry] = {}
        for e in db.scalars(select(LedgerEntry).where(
                LedgerEntry.external_ref.is_not(None))).all():
            ref = str(e.external_ref or "")
            if ref.startswith(tag):
                key = ref[len(tag):]
                # البادئة الفاضية بتطابق الفرعين — الفرق إن مفتاح العلياء بيبدأ بـ`AL-`.
                if not prefix and key.startswith("AL-"):
                    continue
                mine[key] = e

        drifted: list[tuple[str, LedgerEntry, Decimal, Decimal]] = []
        for key, want in src.items():
            e = mine.get(key)
            if e is None:
                continue
            lines = db.scalars(select(LedgerLine).where(
                LedgerLine.entry_id == e.id)).all()
            got = sum((Decimal(str(l.amount or 0)) for l in lines
                       if l.direction == Direction.debit), ZERO)
            got_cr = sum((Decimal(str(l.amount or 0)) for l in lines
                          if l.direction == Direction.credit), ZERO)
            # **الطرفين وعدد السطور — مش المدين وحده.**
            #
            # النسخة الأولى كانت بتقارن المدين بس، فالقيد اللي مدينه صح ودائنه ناقص كان
            # بيعدّي على إنه مطابق. واتقاس: `a5:AL-119625` مدينه ١٤٥٬٠٥٠ زي a5 بالحرف
            # وطرفه الدائن مش موجود — حساب «تكنو بايت» ماكانش متعمل وقت الاستيراد فالسطر
            # اترفض، والحساب اتعمل بعدها، والقيد اتجمّد للأبد لأن `external_ref` بتاعه
            # موجود. قيد بطرف واحد كسر في الميزان مش فرق في رقم، والمقارنة اللي بتشوف
            # طرف واحد عمياها عنه.
            #
            # وعدد السطور بيمسك اللي المبلغين بيخبّوه: سطر اتشال وسطر تاني اتزاد بنفس
            # المبلغ على حساب تاني خالص.
            if (abs(got - want["amount"]) > TOL
                    or abs(got_cr - want["credit"]) > TOL
                    or len(lines) != want["rows"]):
                drifted.append((key, e, max(want["amount"], want["credit"]),
                                max(got, got_cr)))

        if not drifted:
            print("مافيش قيد مبلغه اتغيّر — كله مطابق للتصدير.")
            return 0

        gap = sum((w - g for _k, _e, w, g in drifted), ZERO)
        print(f"قيود هتتعاد: {len(drifted)}   (فرق a5 − عندنا: {gap})\n")
        print(f"{'مفتاح a5':<12}{'قيدنا':<9}{'a5':>16}{'عندنا':>16}{'الفرق':>14}")
        print("-" * 68)
        for key, e, want, got in sorted(drifted, key=lambda x: -abs(x[2] - x[3])):
            print(f"{key:<12}{e.id:<9}{want:>16}{got:>16}{want - got:>14}")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            print("وبعده شغّل `import_a5_ledger` عشان يبنيها من أول وجديد.")
            return 0

        ids = [e.id for _k, e, _w, _g in drifted]
        # ١) فكّ الإشارات — المفتاح الخارجي بيرفض الحذف وهي قايمة.
        unlinked = 0
        for cls in LINKED:
            res = db.execute(sa_update(cls)
                             .where(cls.ledger_entry_id.in_(ids))
                             .values(ledger_entry_id=None))
            unlinked += res.rowcount or 0
        db.flush()
        # ٢) السطور وبعدها الرأس.
        db.execute(sa_delete(LedgerLine).where(LedgerLine.entry_id.in_(ids)))
        db.execute(sa_delete(LedgerEntry).where(LedgerEntry.id.in_(ids)))
        db.commit()
        print(f"\nاتشال {len(ids)} قيد، واتفك ربط {unlinked} مستند.")
        print("شغّل `import_a5_ledger` دلوقتي — هيبنيها من أول وجديد ويربطها بمستنداتها.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in args))
