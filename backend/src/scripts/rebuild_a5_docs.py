"""المستند اللي اتعدّل في a5 بعد ما نقلناه — يتشال من عندنا ويترجع بسطوره الجديدة.

    python -m src.scripts.rebuild_a5_docs --dir C:/pgtmp --branch أكتوبر
    python -m src.scripts.rebuild_a5_docs --dir C:/pgtmp --branch أكتوبر --yes
    python -m src.scripts.rebuild_a5_docs --dir C:/pgtmp/aliaa --branch العلياء --prefix AL- --yes

**درايَ-رن بالافتراضي.** من غير `--yes` بيقول هيعمل إيه وبيقف.

---------------------------------------------------------------------------
**المشكلة اللي بيحلها.** `import_a5_docs` بيتخطّى المستند اللي رقمه موجود، وده اللي
بيخلّيه آمن يتعاد تشغيله كل ليلة. بس العميل بيعدّل مستنداته في a5 بعد ما ننقلها —
سطر يتزاد، كمية تتغيّر، صنف يتبدّل — والتخطّي بيخلّي نسختنا مجمّدة على اللي كان.
بيبان كفرق في الرصيد مالوش تفسير: ٨ مستندات في أكتوبر و٥ في العلياء لحد ٢٠٢٦-٠٩-١٣.

**بيتصلّح بالهدم وإعادة البناء، مش بالتصحيح.** التصحيح معناه إننا نقرّر أنهي سطر يتظبط
وبكام، والمصدر قال خلاص: المستند هو ده. فبنشيل نسختنا بالكامل — سطورها وحركات المخزون
اللي طلعت منها — وبنسيب `import_a5_docs` يبنيه من أول وجديد. هو نفس الكود اللي بنى
الباقي، فمافيش طريق تاني للبيانات يتصان لوحده.

**القيود مابتتلمسش.** `import_a5_docs` مابيكتبش قيود أصلاً — `import_a5_ledger` سكربت
منفصل بيربط القيد بالمستند عن طريق `ledger_entry_id`. فلما المستند يتعاد بناؤه، الربط
بيبقى فاضي، وتشغيلة `import_a5_ledger` بعده بتربطه تاني (هو مكتوب بيربط اللي `None`).
فسلسلة `a5_sync.ps1` بترتيبها بتصلّح ده لوحدها.

**الرصيد مشتق من الحركة**، فمسح حركات المستند متّسق: `on_hand` بيجمّع `stock_movement`
وقت السؤال، مافيش رقم مخزّن يفضل فاكر الحركة اللي اتشالت.

⛔ **ومابيلمسش مستند إحنا عملناه.** بيشتغل على اللي `audit_a5_doc_drift` لقاه مختلف بس —
يعني مستند رقمه من a5 وموجود في التصدير. فاتورة اتكتبت في نظامنا مالهاش نظير في a5
عمرها ما تدخل القايمة.
"""
from __future__ import annotations

import sys
from collections import defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.stock import StockMovement
from src.scripts import import_a5_docs
from src.scripts.audit_a5_doc_drift import TABLES, collect

# نوع a5 → قيمة `source_doc_type` على حركة المخزون
DOC_TYPE = {
    "7": "sales_invoice",
    "2": "sales_return",
    "1": "purchase_invoice",
    "11": "purchase_return",
    "6": "stock_transfer",
    "3": "stock_permit",
}


def _demolish(db, a5_type: str, number: str) -> tuple[int, int]:
    """يشيل المستند وسطوره وحركاته. بيرجّع (سطور، حركات)."""
    head_cls, line_cls, fk = TABLES[a5_type]
    head = db.scalar(select(head_cls).where(head_cls.document_number == number))
    if head is None:
        return 0, 0

    moves = db.scalars(
        select(StockMovement).where(
            StockMovement.source_doc_type == DOC_TYPE[a5_type],
            StockMovement.source_doc_id == head.id)).all()
    lines = db.scalars(select(line_cls).where(getattr(line_cls, fk) == head.id)).all()

    # السطر بيشاور على الحركة، فالسطر الأول والحركة بعده — وإلا المفتاح الخارجي بيرفض.
    for ln in lines:
        db.delete(ln)
    db.flush()
    for mv in moves:
        db.delete(mv)
    db.flush()
    db.delete(head)
    db.flush()
    return len(lines), len(moves)


def run(folder: str, *, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        drift, missing, _unresolved = collect(db, folder, prefix)
        if not drift and not missing:
            print("مافيش مستند مختلف — كله زي a5.")
            return 0

        by_kind: dict[str, int] = defaultdict(int)
        for d in drift:
            by_kind[d.label] += 1
        print(f"مستندات هتتعاد: {len(drift)}")
        for k, n in sorted(by_kind.items(), key=lambda x: -x[1]):
            print(f"   {k:<18}{n:>5}")
        for d in drift:
            print(f"   {d.number:<14}{d.doc_date}  {d.label}")
        if missing:
            print(f"\nومستندات في a5 ومش عندنا خالص ({len(missing)}) — "
                  "الاستيراد هيحاول يعملها، وأي سبب تخطّي هيتقال في تقريره:")
            for label, number, dt in missing[:20]:
                print(f"   {number:<14}{dt}  {label}")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ.")
            return 0

        print("\n— الهدم —")
        total_lines = total_moves = 0
        for d in drift:
            n_lines, n_moves = _demolish(db, d.a5_type, d.number)
            total_lines += n_lines
            total_moves += n_moves
            print(f"   {d.number:<14} اتشال: {n_lines} سطر، {n_moves} حركة")
        db.commit()
        print(f"إجمالي: {total_lines} سطر، {total_moves} حركة مخزون")

        print("\n— إعادة البناء —")
        import_a5_docs.run(folder, execute=True, branch_name=branch_name, prefix=prefix)

        # الاستيراد بيفتح جلسته الخاصة، فجلستنا دي شايفة اللقطة القديمة — من غير
        # `expire_all` التأكيد بيقرا اللي كان قبل البناء ويقول إن كله لسه مختلف.
        db.expire_all()

        # التأكيد من نفس المسطرة اللي كشفت المشكلة.
        drift2, missing2, _ = collect(db, folder, prefix)
        print(f"\nبعد الإعادة: مختلف {len(drift2)}   مش عندنا {len(missing2)}")
        for d in drift2:
            print(f"   لسه مختلف: {d.number} ({d.label})")
        return 0 if not drift2 else 1
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    if not branch:
        print("لازم --branch (اسم الفرع عندنا) — الاستيراد بيتعلّق بيه.")
        sys.exit(2)
    sys.exit(run(folder, branch_name=branch, prefix=prefix, execute="--yes" in args))
