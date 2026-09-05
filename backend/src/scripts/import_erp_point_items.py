"""يملا كتالوج أصناف المعاينة (`inspection_item_type`) من كتالوج نظام ما بعد البيع.

    python -m src.scripts.import_erp_point_items --dir C:/pgtmp/erp
    python -m src.scripts.import_erp_point_items --dir C:/pgtmp/erp --yes

المصدر `erp.wh_Items` مصدَّر لـ`point_items.tsv` بفاصل `~`:
`ID~Code~Name_Ar~النقاط~OrderBy~Inactive~Status~عدد البنود اللي اتسجّلت عليه`

بيتعاد تشغيله بأمان: المطابقة بالاسم المتطبّع، والموجود بتتحدّث نقطته والناقص بيتعمل.

---------------------------------------------------------------------------
اللي اتقاس قبل ما السكربت يتكتب:

* **قيمة النقطة مخبّية في عمود `Notes`.** مافيش عمود اسمه نقاط في `wh_Items` خالص.
  والدليل مش تخمين: قارنّا `Notes` بـ`PointCount` المتسجّل فعلاً على الـ٨٠ ألف بند في
  `wh_TechnicalVisitItems` — على الـ٤٢ صنف كلهم، `Notes` هي القيمة اللي البند بيتسجّل
  بيها. (القيم التانية اللي بتظهر جنبها أرقام مقرّبة جاية من التطبيق زي `0.166666667`،
  مش قيمة تانية للصنف.)

* **٢٢ صنف عندنا نقطته صفر.** الكتالوج عندنا فيه ٥٤ اسم: ٢٠ ماخدين نقطهم صح، و٢٢
  قاعدين على صفر — دول عيلة «ابيض» و«بجوان» و«قفيز» اللي المصدر بيقول عليها ٠٫١٦٦٧
  و٢٫١٦٦٧ وهكذا. الصنف اللي نقطته صفر معناه معاينة بتتحسب بصفر، والتاجر بيشتكي بعد
  شهور من غير ما يبان سبب. ده اللي السكربت موجود عشانه.

* **ملف الإكسل بتاع العميل قديم.** ورقة «قطع» فيها ٣٢ صنف بأسماء مدموجة
  («قطعه صرف 1" او 1.5" ابيض او جوان»)، والقاعدة الحيّة فيها ٤٢ بعد ما النظام فصل
  «ابيض» عن «بجوان» صنفين. والفصل ده مش على ورق: الأصناف المفصولة عليها بنود متسجّلة
  فعلاً (٧٠ و٧٩ و١٥٨ …). فالمصدر هنا القاعدة، والورقة اتسابت.

* **١٢ اسم عندنا المصدر مابقاش فيه.** دي الأسماء المدموجة القديمة اللي جت من الورقة.
  السكربت **مابيمسحهاش ومابيقفلهاش** — بيطبعها بس. مين يتشال ومين يتسمّى قرار مكتب،
  والصنف اللي اتقفل غلط بيختفي من موبايل المندوب من غير ما حد ياخد باله.

* **الترتيب مابيتلمسش على الموجود.** `Code` في المصدر هو ترتيب القايمة عندهم (١…٤٣)،
  وترتيبنا دلوقتي مخالفه في صفوف كتير. بس النقطة الغلط رقم بيتصحّح، والترتيب تفضيل
  شاشة — السكربت بيطبع الفرق ويسيب القرار، وبيكتب الترتيب على الصفوف اللي بيعملها هو بس.
"""
from __future__ import annotations

import os
import re
import sys
import unicodedata
from collections import defaultdict
from decimal import Decimal, InvalidOperation

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.inspection_item_type import InspectionItemType
from src.scripts.import_a5 import JUNK, _clean, _read

# أعمدة الملف المصدَّر
(P_ID, P_CODE, P_NAME, P_POINTS, P_ORDER, P_INACTIVE, P_STATUS, P_USED) = range(8)

# النقطة بتتخزن عندنا بأربع خانات عشرية عشان الأسداس (١/٦، ١/٣) تتجمّع صح. والتقريب
# لازم يحصل قبل المقارنة، وإلا `0.166666666666667` بتبان مخالفة لـ`0.1667` في كل
# تشغيلة، والسكربت يفضل «يعدّل» حاجة مش متغيّرة ويقول إنه عمل شغل.
QUANT = Decimal("0.0001")

_MARKS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]")
_FOLD = {
    "\u0623": "\u0627", "\u0625": "\u0627", "\u0622": "\u0627", "\u0671": "\u0627",
    "\u0649": "\u064a", "\u06cc": "\u064a",
    "\u0629": "\u0647",
    "\u06a9": "\u0643",
}


def _norm(name: str) -> str:
    """اسم الصنف في صورة واحدة يتقارن بيها.

    الأسماء دي مكتوبة بأيادي مختلفة على مدى سنين: همزة وياء وتاء مربوطة، ومسافة زيادة
    قبل علامة البوصة، ومسافة غير قابلة للكسر جوّه الاسم. من غير التطبيع المطابقة بتطلع
    أرقام ضعيفة والسكربت بيقول «تمام» وهو نصّه فاضي.
    """
    text = unicodedata.normalize("NFKC", str(name or "")).replace("\u00a0", " ")
    text = _MARKS.sub("", text)
    for src, dst in _FOLD.items():
        text = text.replace(src, dst)
    return re.sub(r"\s+", " ", text).strip().lower()


def _points(raw: str) -> Decimal | None:
    try:
        return Decimal((raw or "").strip() or "0").quantize(QUANT)
    except (InvalidOperation, ValueError):
        return None


def run(folder: str, *, execute: bool) -> None:
    rows = [r for r in _read(os.path.join(folder, "point_items.tsv")) if len(r) >= 8]
    if not rows:
        raise SystemExit("مافيش point_items.tsv في " + folder)

    # المصدر نفسه ممكن يكون فيه اسمين بيتطابقوا بعد التطبيع — لازم يتقال قبل الكتابة،
    # لأن المطابقة بالاسم ساعتها بتخلّي التاني يدهس الأول من غير ما يبان.
    src: dict[str, list[list[str]]] = defaultdict(list)
    bad_points: list[str] = []
    for r in rows:
        name = _clean(r[P_NAME])
        if not name or JUNK.match(name):
            continue
        if _points(r[P_POINTS]) is None:
            bad_points.append(f"{r[P_ID]} «{name}»: نقطة مش رقم ({r[P_POINTS]!r})")
            continue
        src[_norm(name)].append(r)

    print(f"المصدر (erp.wh_Items): {len(rows)} صنف، منهم {len(src)} اسم متمايز")
    dup_src = {k: v for k, v in src.items() if len(v) > 1}

    db = SessionLocal()
    try:
        ours = db.scalars(select(InspectionItemType)).all()
        by_norm: dict[str, list[InspectionItemType]] = defaultdict(list)
        for t in ours:
            by_norm[_norm(t.name)].append(t)
        print(f"عندنا الآن: {len(ours)} صنف\n")

        create: list[list[str]] = []
        fix_points: list[tuple[InspectionItemType, Decimal, Decimal]] = []
        same: list[InspectionItemType] = []
        order_gap: list[tuple[InspectionItemType, int, int]] = []
        collide: list[str] = []
        matched: set[str] = set()

        for key, group in sorted(src.items(), key=lambda kv: int(kv[1][0][P_ID])):
            row = group[0]
            pts = _points(row[P_POINTS])
            targets = by_norm.get(key, [])
            if not targets:
                create.append(row)
                continue
            matched.add(key)
            if len(targets) > 1:
                collide.append(f"«{_clean(row[P_NAME])}» بيقابل {len(targets)} صف عندنا")
            target = targets[0]
            old = Decimal(str(target.points)).quantize(QUANT)
            if old == pts:
                same.append(target)
            else:
                fix_points.append((target, old, pts))
            want = int(row[P_CODE]) if row[P_CODE].isdigit() else target.sort_order
            if want != target.sort_order:
                order_gap.append((target, target.sort_order, want))

        # اللي عندنا والمصدر مش عارفه: الأسماء المدموجة القديمة اللي جت من ورقة الإكسل.
        orphans = [t for t in ours if _norm(t.name) not in src]

        print(f"{'الحالة':<34}{'عدد':>8}")
        print("-" * 44)
        print(f"{'نقطته صح زي المصدر':<34}{len(same):>8}")
        print(f"{'نقطته هتتصحّح':<34}{len(fix_points):>8}")
        print(f"{'صنف جديد هيتعمل':<34}{len(create):>8}")
        print(f"{'عندنا والمصدر مش عارفه':<34}{len(orphans):>8}")

        if fix_points:
            print(f"\n— النقط اللي هتتصحّح ({len(fix_points)}):")
            print(f"   {'الصنف':<46}{'من':>10}{'إلى':>12}")
            for t, old, new in fix_points:
                print(f"   {t.name[:44]:<46}{str(old):>10}{str(new):>12}")

        if create:
            print(f"\n— أصناف جديدة ({len(create)}):")
            for r in create:
                print(f"   [{r[P_CODE]:>3}] {_clean(r[P_NAME])[:50]:<52}"
                      f"نقطة={_points(r[P_POINTS])}  بنود={r[P_USED]}")

        if orphans:
            # مابتتشالش ومابتتقفلش — قرار مكتب. اللي اتقفل غلط بيختفي من الموبايل
            # من غير ما حد ياخد باله.
            print(f"\n⚠️ عندنا ومش في المصدر ({len(orphans)}) — للمراجعة، السكربت مش هيلمسها:")
            for t in orphans:
                print(f"   #{t.id:<5}{t.name[:50]:<52}نقطة={t.points} فعّال={t.active}")

        if dup_src:
            print(f"\n⚠️ اسم مكرر في المصدر نفسه ({len(dup_src)}) — الأول بس اللي اتاخد:")
            for _key, group in dup_src.items():
                ids = ", ".join(g[P_ID] for g in group)
                print(f"   «{_clean(group[0][P_NAME])}» → {ids}")

        if collide:
            print(f"\n⚠️ اسم من المصدر بيقابل أكتر من صف عندنا ({len(collide)}):")
            for c in collide:
                print("   ", c)

        if bad_points:
            print(f"\n⚠️ نقطة مش رقم ({len(bad_points)}) — اتخطّت:")
            for b in bad_points:
                print("   ", b)

        if order_gap:
            print(f"\nℹ️ الترتيب مختلف عن المصدر في {len(order_gap)} صف — مش هيتغيّر."
                  " `Code` عندهم هو ترتيب القايمة، وترتيب الشاشة قرار مكتب:")
            for t, was, want in order_gap:
                print(f"   {t.name[:46]:<48}عندنا {was:>3} → عندهم {want:>3}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        # الحارس: بيقيس تاني قبل ما يكتب. لو حد ضاف صنف من الشاشة بين العرض والتنفيذ،
        # الاسم بيبقى موجود، والإضافة بتكسر قيد `unique` وتوقّف النقل كله عند أول واحد.
        have = {_norm(t.name) for t in db.scalars(select(InspectionItemType)).all()}
        order = max([t.sort_order for t in ours] or [0])
        fixed = created = 0
        for t, _old, new in fix_points:
            t.points = new
            fixed += 1
        for r in create:
            name = _clean(r[P_NAME])
            if _norm(name) in have:
                print(f"   ⚠️ «{name}» اتعمل في الوقت الضايع — اتخطّى.")
                continue
            sort_order = int(r[P_CODE]) if r[P_CODE].isdigit() else order + 1
            order = max(order, sort_order)
            db.add(InspectionItemType(
                name=name[:200], points=_points(r[P_POINTS]),
                sort_order=sort_order,
                # `Inactive` عندهم بيشيل الصنف من قايمة الاختيار، مابيمسحهوش.
                active=(r[P_INACTIVE] != "1" and r[P_STATUS] != "0")))
            have.add(_norm(name))
            created += 1
        db.commit()
        print(f"\n✔ اتصحّحت {fixed} نقطة، واتعمل {created} صنف جديد.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    target_dir = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/erp"
    run(target_dir, execute="--yes" in args)
