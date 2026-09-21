"""مورد في كشف a5 ومالوش كارت عندنا — بيتعمل بكوده الحقيقي. درايَ-رن بالافتراضي.

    python -m src.scripts.import_a5_suppliers \
        --dir /opt/techno/a5factory --prefix FC- --branch السادات          # يعرض بس
    python -m src.scripts.import_a5_suppliers \
        --dir /opt/techno/a5factory --prefix FC- --branch السادات --yes    # ينفّذ

---------------------------------------------------------------------------
**المشكلة اللي بيحلها.** فرع المصنع كشف مورديه في a5 فيه **١١١ مورد**، وملف التصدير
`a5_misc.tsv` فيه نفس الـ١١١ صف `SUPP` — وعندنا **٥ كروت بس**. يعني ١٠٦ مورد بالاسم
والتليفون والعنوان مانُقلوش خالص.

وأسوأ من العدد: الخمسة اللي موجودين **مش منقولين من الكشف أصلاً**. أكوادهم
`{prefix}A5X…`، يعني `Ctx.party()` في `import_a5_docs` هي اللي عملتهم لما لقت فاتورة
شرا بطرف مالوش كارت. الكارت المخترع ده فيه الاسم وبس: مافيش تليفون ولا عنوان ولا رقم
المورد في a5 — وبالتالي أي نقل جاي مش هيعرف يربطه بصاحبه.

**ليه `import_a5.py` ماعملهمش؟** هو بيعمل الموردين فعلاً من صفوف `SUPP`، بس المطابقة
عنده بالاسم على **كل** الموردين في القاعدة من غير تقييد بالبادئة. والمصنع اتنقل
بالمستندات (`import_a5_docs`) من غير ما المرحلة الأساسية تجري عليه بالبادئة بتاعته،
فالكشف فضل مقروش. السكربت ده بيعمل الجزء ده لوحده، ومن غير ما يلمس أي حاجة تانية.

---------------------------------------------------------------------------
**الكود هو المفتاح، مش الاسم.** `{prefix}A5-{Mourd_id}` — نفس اللي `import_a5` بيكتبه
ونفس اللي `Ctx.party()` بيدوّر بيه أول حاجة. الموجود بيتخطّى بالكود، فتشغيلتين ورا بعض
بيدّوا نفس النتيجة.

**والمطابقة بالاسم للتقرير بس.** الكارت المخترع (`A5X`) اللي اسمه مطابق لمورد في الكشف
بيتطبع في تقرير لوحده مع رقم المورد الحقيقي — **ومابيتدمجش ولا بيتمسح ولا بيتغيّر
نوعه**.

⛔ **الدمج قرار صاحب الشغل مش قرار سكربت.** الكارت المخترع عليه رصيد وفواتير حقيقية،
والدمج بينقل الرصيد معاه؛ وفيه كروت `A5X` اتعملت **كعملاء** وعليها فواتير **بيع** —
تحويل واحد فيهم لمورد بيسيب فواتير بيع بلا عميل. فالتقرير بيقول «دول يستاهلوا نظرة»
وبس، والباقي على اللي فاهم الشغل.

**المطابقة بتتجاهل الهمزة والتاء المربوطة** (`arabic.bare`) لأن «عبدالله» و«عبد اللة»
راجل واحد في الكشف وفي الفواتير — بس ماعدا كده الاسم لازم يكون مطابق بالحرف، عشان
«تكنو» و«تكنو ثيرم» مايتعدّوش على إنهم واحد.

---------------------------------------------------------------------------
🔴 **النظام شغّال عند العميل على تلات فروع دلوقتي.** فالسكربت ده:

* **بيضيف وبس** — ولا `UPDATE` ولا `DELETE` ولا تغيير نوع كارت، ولا حتى على الفرع
  المستهدف نفسه.
* **كل استعلام مقيّد** إما بالفرع أو بالبادئة، مكتوب على كل نداء لوحده مش مرة واحدة
  فوق. فرع من غير `--prefix` بيفضل خارج المدى لأن كشفه بأكواد تانية.
* **الكارت اللي كوده موجود بره الفرع بيتساب** ويتقال — مش بيتكتب فوقه ولا بيتنقل.
  قيد التفرّد على `supplier.code` عام على القاعدة كلها، فالكتابة عليه كانت هتقع أصلاً،
  والأهم إنه ممكن يكون كارت فرع تاني بيشتغل عليه حد دلوقتي.
"""
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
    """صفوف `SUPP` من `a5_misc.tsv`: (رقم المورد، الاسم، التليفون، العنوان).

    نفس ترتيب الأعمدة اللي `import_a5` بيقرا بيه — ده ملف تصدير واحد، ولو الترتيب
    اتغيّر لازم يتغيّر في الاتنين مع بعض.
    """
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

        # الموجود بكوده الحقيقي. الاستعلام مقيّد **بالبادئة** — وهي مفتاح الفرع في
        # أكواد a5 — مش بـ`branch_id`: قيد التفرّد على `supplier.code` عام على القاعدة،
        # فلو قصرنا الشوفة على الفرع وفيه كارت بنفس الكود مربوط بفرع تاني (أو `branch_id`
        # بتاعه فاضي من نقل قديم) الإدخال كان هيقع على القيد — أو أسوأ، نفتكره ناقص.
        have = {s.code: s for s in db.scalars(
            select(Supplier).where(Supplier.code.startswith(f"{prefix}A5-"))).all() if s.code}

        # الاسم المجرّد لكل مورد في الكشف. لو اسمين في الكشف بيتجرّدوا لنفس الحاجة،
        # المطابقة عليهم بتبقى ملتبسة — بنسيبها بدل ما نقول لصاحب الشغل رقم غلط.
        by_bare: dict[str, list[str]] = defaultdict(list)
        for a5_id, name, _ph, _ad in rows:
            by_bare[bare(name)].append(a5_id)

        missing: list[tuple[str, str, str, str]] = []
        # كوده موجود بس على فرع تاني — بيتقال ومابيتلمسش. الشرح فوق في الترويسة.
        foreign: list[tuple[str, str, int | None]] = []
        for a5_id, name, phone, address in rows:
            code = f"{prefix}A5-{a5_id}"
            hit = have.get(code)
            if hit is not None:
                if hit.branch_id is not None and hit.branch_id != branch.id:
                    foreign.append((code, hit.name, hit.branch_id))
                continue
            missing.append((a5_id, name, phone, address))

        # الكروت المخترعة — موردين وعملاء، لأن `Ctx.party()` بيعمل الاتنين.
        #
        # مقيّدة بالفرع **وبالبادئة** مع بعض: البادئة لوحدها مابتمنعش كارت اتنقل بنفس
        # البادئة وبعدين اتنقل لفرع تاني من الشاشة، و`branch_id` لوحده بيجيب كروت
        # `A5X` بتاعة فروع مالهاش بادئة. الاتنين مع بعض بيخلّوا الكشف بتاع الفرع ده وبس.
        invented: list[tuple[str, str, str, str]] = []   # (النوع، الكود، الاسم، رقم المورد)
        ambiguous: list[tuple[str, str, str]] = []       # (النوع، الكود، الاسم)
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
                # القص على حد العمود قبل الإدخال — عنوان طويل واحد بيوقّف النقل كله.
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
