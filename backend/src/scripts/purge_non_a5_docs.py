"""المستندات اللي إحنا عملناها ومالهاش نظير في a5 — بتتشال هي وأثرها. درايَ-رن بالافتراضي.

    python -m src.scripts.purge_non_a5_docs --dirs C:/pgtmp,C:/pgtmp/aliaa --prefixes ,AL-
    python -m src.scripts.purge_non_a5_docs --branch العلياء --yes

---------------------------------------------------------------------------
**إيه ده.** `audit_own_stock_docs` بيقول إيه اللي عندنا ومش في a5 — فواتير التجربة اللي
اتكتبت من التطبيق ومن الشاشة وإحنا بنجرّب. البضاعة اتحركت عندنا فعلاً وa5 مايعرفش عنها،
فرصيده بيفضل أعلى: **٩٥٠ وحدة في العلياء** وقت القياس (٢٣ فاتورة −٩٦٢، مردودين +١٢،
٩ تحويلات صافيها صفر بس بتنقل بين المخازن).

الفرق ده **مش غلط في النقل** — ده الفرق الطبيعي بين نظامين شغّالين على التوازي. السكربت
ده بيقفله بشرط واحد: إن المستندات دي تجارب. لو فيها بيعة حقيقية، اللي بيتشال بضاعة
اتباعت فعلاً وفلوس اتقيّدت على عميل.

**التفرقة بالرقم مش بالتاريخ.** المستند المنقول رقمه من المستورد (`{prefix}{tag}{a5_id}`)
وموجود في التصدير. أي رقم تاني = مستند مالوش نظير في a5. النقل بيحط تاريخ a5 على المستند،
فالتاريخ مابيقولش مين كتبه.

**والقاعدة دي بتلقط نوعين، مش نوع واحد:**

١. **مستند إحنا كتبناه** — رقمه من `numbering.py` (`SINV-000012`، `TRF-000004`).

٢. **مستند اتمسح عند a5 بعد ما نقلناه** — رقمه من a5 (`T1007`) بس مابقاش في التصدير.
   المزامنة عمرها ما بتشيل مستند اختفى من المصدر: `import_a5_docs` بيضيف ويتخطّى،
   مافيش خطوة بتقول «ده كان وبقى مش موجود». فنسختنا بتفضل بحركتها للأبد. اتقاس:
   `T1007` اتمسح في a5 وفضل عندنا بـ٣٨ حركة بتنقل بضاعة من «مخزن الفيوم» لـ«مخزن
   سياره 1» — صافيه صفر على الشركة، وغلط في كل مخزن على حدة.

⚠️ **والنوع التاني هو السبب اللي بيخلّي الحذف التلقائي ممنوع.** تصدير ناقص، أو نوع
مستند المستورد مابيعرفوش، بيبان بالظبط زي «اتمسح عند المصدر» — والفرق بينهم إن الأول
غلط في القراءة والتاني حقيقة. عشان كده السكربت **درايَ-رن بالافتراضي وبيدّي الأرقام
قبل أي كتابة**، ومش مربوط بالسلسلة اليومية.

**والحذف بيعدّي على الخدمة مش على الجدول.** `document_edit_service.delete_sale` بيشيل
القيد وحركة المخزون والسطور والنقاط والكوبونات والسيريالات ويفك الدفعات — ومسح الصف
بالإيد بيسيب كل ده وراه. ودي بالظبط الغلطة اللي عملت `stock_transfer#2527`: رأس اتشال
وحركاته فضلت، ٥٣ وحدة في المخزن الغلط ومافيش ورقة تقول ليه.

⛔ **مابيلمسش مستند رقمه في تصدير a5** — ولا واحد، مهما كان تاريخه.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.org import Branch
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.user import User
from src.models.warehouse import Warehouse
from src.scripts.audit_a5_doc_drift import TABLES
from src.scripts.audit_own_stock_docs import DOC_TYPES
from src.scripts.import_a5 import _read
from src.scripts.import_a5_docs import KIND, L_QTY, L_TYPE, _doc_key
from src.services import document_edit_service, transfer_service

ZERO = Decimal("0")

# نوع a5 → إزاي المستند ده بيتشال. الترتيب في `ORDER` بيحط المردود قبل الفاتورة، لأن
# الفاتورة اللي عليها مردود بترفض التعديل — و`delete_sale` بيجرّ مرتجعاتها معاه أصلاً.
DELETERS = {
    "7": ("فواتير بيع", lambda db, h, uid:
          document_edit_service.delete_sale(db, invoice_id=h.id, actor_user_id=uid)),
    "2": ("مردود مبيعات", lambda db, h, uid:
          document_edit_service.delete_sales_return(db, return_id=h.id, actor_user_id=uid)),
    "1": ("فواتير شرا", lambda db, h, uid:
          document_edit_service.delete_purchase(db, purchase_id=h.id, actor_user_id=uid)),
    "11": ("مردود مشتريات", lambda db, h, uid:
           document_edit_service.delete_purchase_return(db, return_id=h.id, actor_user_id=uid)),
    "6": ("تحويلات", lambda db, h, uid:
          transfer_service.delete(db, transfer_id=h.id, actor_user_id=uid)),
}
ORDER = ["2", "11", "7", "1", "6"]


def _a5_numbers(pairs: list[tuple[str, str]]) -> set[str]:
    nums: set[str] = set()
    for folder, prefix in pairs:
        for r in _read(os.path.join(folder, "a5_lines.tsv")):
            if len(r) <= L_QTY:
                continue
            t = r[L_TYPE].strip()
            if t in KIND:
                nums.add(f"{prefix}{KIND[t][1]}{_doc_key(r).strip()}")
    return nums


def run(pairs: list[tuple[str, str]], *, branch_name: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        a5 = _a5_numbers(pairs)
        if not a5:
            print("التصدير فاضي — مافيش مقارنة تتعمل. شغّل `a5_sync.ps1 -ExportOnly` الأول.")
            return 2
        print(f"أرقام مستندات a5: {len(a5)}")

        branch = None
        if branch_name:
            branch = db.scalar(select(Branch).where(Branch.name == branch_name))
            if branch is None:
                print(f"الفرع «{branch_name}» مش موجود.")
                return 2
        # مخازن الفرع — المستند بيتبع الفرع اللي بضاعته اتحركت فيه، مش اللي مكتوب عليه:
        # الرأس ممكن يكون فرعه فاضي، والحركة بتقول المخزن بالتحديد.
        in_branch = {w.id for w in db.scalars(select(Warehouse)).all()
                     if branch is None or w.branch_id == branch.id}

        actor = db.scalar(select(User).order_by(User.id))
        if actor is None:
            print("مافيش مستخدم يتسجّل عليه الحذف.")
            return 2

        item_name = {i.id: i.name for i in db.scalars(select(Item)).all()}
        wh_name = {w.id: w.name for w in db.scalars(select(Warehouse)).all()}

        picked: list[tuple[str, str, object]] = []
        effect: dict[tuple[int, int], Decimal] = defaultdict(Decimal)
        other_branch = 0

        for a5_type in ORDER:
            head_cls, _lc, _fk = TABLES[a5_type]
            label, _fn = DELETERS[a5_type]
            for h in db.scalars(select(head_cls)).all():
                if h.document_number in a5:
                    continue
                moves = db.scalars(select(StockMovement).where(
                    StockMovement.source_doc_type.in_(DOC_TYPES[a5_type]),
                    StockMovement.source_doc_id == h.id)).all()
                where = {m.location_id for m in moves
                         if m.location_kind == LocationKind.warehouse}
                if branch is not None and where and not (where & in_branch):
                    other_branch += 1
                    continue
                picked.append((a5_type, label, h))
                for m in moves:
                    if m.location_kind != LocationKind.warehouse:
                        continue
                    q = Decimal(str(m.quantity or 0))
                    effect[(m.item_id, m.location_id)] += (
                        q if m.direction == StockDirection.in_ else -q)

        if not picked:
            print("مافيش مستند من بتاعنا في الفرع ده.")
            return 0

        by_kind: dict[str, list[str]] = defaultdict(list)
        for _t, label, h in picked:
            by_kind[label].append(h.document_number)
        print(f"\nمستندات هتتشال: {len(picked)}"
              + (f"   (الفرع: {branch_name})" if branch_name else ""))
        for label, nums in by_kind.items():
            print(f"   {label:<16}{len(nums):>4}   {'، '.join(sorted(nums)[:6])}"
                  + (" …" if len(nums) > 6 else ""))
        if other_branch:
            print(f"   (و{other_branch} مستند بتاعنا في فرع تاني — مااتلمسوش)")

        effect = {k: v for k, v in effect.items() if v != ZERO}
        print(f"\nالرصيد اللي هيترجّع: {len(effect)} زوج (صنف × مخزن)"
              f"   صافي {sum(effect.values(), ZERO)}")
        for (i, w), v in sorted(effect.items(), key=lambda x: -abs(x[1]))[:25]:
            print(f"   {item_name.get(i, str(i))[:29]:<30}"
                  f"{wh_name.get(w, str(w))[:21]:<22}{v:>10}")
        if len(effect) > 25:
            print(f"   … و{len(effect) - 25} زوج كمان")

        if not execute:
            print("\nدرايَ-رن. `--yes` عشان ينفّذ — **والحذف مالوش رجوع**.")
            return 0

        done = failed = 0
        for a5_type, label, h in picked:
            _lbl, fn = DELETERS[a5_type]
            num = h.document_number
            try:
                fn(db, h, actor.id)
                db.commit()
                done += 1
            except Exception as exc:  # مستند بيرفض بيتقال ومابيوقّفش الباقي
                db.rollback()
                failed += 1
                print(f"   ✘ {num}: {type(exc).__name__}: {exc}")
        print(f"\nاتشال {done} مستند." + (f"   واترفض {failed}." if failed else ""))
        return 1 if failed else 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    dirs = (args[args.index("--dirs") + 1] if "--dirs" in args
            else "C:/pgtmp,C:/pgtmp/aliaa").split(",")
    prefixes = (args[args.index("--prefixes") + 1] if "--prefixes" in args
                else ",AL-").split(",")
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    sys.exit(run(list(zip(dirs, prefixes, strict=True)),
                 branch_name=branch, execute="--yes" in args))
