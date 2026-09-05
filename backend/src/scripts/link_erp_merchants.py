"""يربط تجار نظام ما بعد البيع (`erp`) بكروت العملاء عندنا — بالكود، مش بالاسم.

    python -m src.scripts.link_erp_merchants --dir C:/pgtmp/erp          # يعرض بس
    python -m src.scripts.link_erp_merchants --dir C:/pgtmp/erp --yes    # ينفّذ

بيتعاد تشغيله بأمان: الربط الموجود بيتخطى، واللي بيتعارض بيتقال ومابيتغيّرش.

---------------------------------------------------------------------------

**ليه الخطوة دي أصلاً.** المعاينة بتقول تاجرها برقم، والكوبون بيقول موزعه برقم، والرقمين
دول من نظام تاني. من غير جسر، `import_erp_visits` و`import_erp_coupons` بيدوّروا على
`ERP-M-{id}` و`ERP-D-{id}` جوّه `customer.code` — والكشف عندنا كله جاي من a5 بأكواد
`AL-A5-…`، فالبحث بيرجع فاضي و١٠٬٨١٤ معاينة و١٩٬٧٢٣ ورقة كوبون بيقعوا على «مالوش تاجر».
`fix_inspection_merchants` كان بيسدّها بالمطابقة بالاسم — وده اللي الجسر ده بيلغيه.

**والاسم مايتطابقش بيه.** a5 بيفرّق «احمد» عن «أحمد» — همزة، كارتين، راجلين مختلفين
عنده. والأسماء عندنا اتعدّلت من الشاشة بعد النقل. فالجسر ده كود لكود من أول سطر لآخره،
والاسم في الملف للعرض في التقرير بس.

---------------------------------------------------------------------------
أربع قرارات، كلها متقاسة:

* **الورقة «1» هي الجسر المعتمد، مش «0» ولا «2».** التلاتة في نفس الملف وبيتقاطعوا:
  «0» نسخة خام من `wh_Merchants` ومافيهاش عمود a5 خالص. «2» فيها كود a5 بس مزحلقة —
  ٧٩ صف بيدّوا كود غير اللي في «1»، وبمقارنة الاسم على الكشف عندنا «1» بتوافق ٤٣٧ من
  ٤٤٥ (٩٨٪) و«2» بتوافق ٣٥٠ من ٤٢٥ (٨٢٪). والزحلقة بتبان بالعين: «2» بتدّي كود
  «محمود عسكر» لكارت «عبدالعظيم عبدالوهاب». فالمقروء هنا «1» بس.

* **رقمين للتاجر الواحد، مش رقم.** `wh_Merchants.ID` هو اللي المعاينة بتشاور بيه،
  و`wh_Distributors.ID` هو اللي الكوبون بيشاور بيه — و٧٤ رقم موجود في الجدولين لناس
  مختلفة، فالرقم العاري مايكفيش. الاتنين بيتسجّلوا ببادئة (`ERP-M-` و`ERP-D-`)،
  والجدولين بيتلمّوا على بعض بـ`Code` — وهو فريد في الاتنين (٤٤٣ و٤٦٢ من غير تكرار).

* **الجسر كتير-لواحد، فمكانه صف مش عمود.** ٤٤٧ كارت تاجر قديم بيقعوا على ٤٣٤ كارت
  عندنا: اتناشر كارت بيلمّوا كارتين أو تلاتة، وسبعة منهم عليهم مستندات على أكتر من
  رقم («عبده السنوسى» ١٩١ كوبون و«عبده السنوسى 2» واحد؛ «حماده الوكيل» ٢٦ معاينة
  و«حماده الجمل» ١١٣). عمود واحد على `customer` بيشيل مفتاح واحد ويسيب الباقي يقع في
  صمت، فالربط بيتخزّن في `customer_external_ref` — صف لكل مفتاح.

* **اللي مالوش كود a5 مايتخمّنش.** ١٥ كارت في `erp` مافيش قصاده كود في الورقة، وكودين
  (`AL-A5-397` و`AL-A5-4327`) مكتوبين في الورقة ومش موجودين في الكشف عندنا. الاتنين
  بيتقالوا بالاسم في آخر التقرير عشان المكتب يقرر — والسكربت مابيخترعش كارت ومابيقرّبش
  اسم.

---------------------------------------------------------------------------
**الملف** `merchant_bridge.tsv` — TSV بترويسة، بيتعمل مرة واحدة قبل التشغيل من حاجتين:

١. استعلام قراءة على `erp` (الجدولين بيتلمّوا بالكود، والعدّ عشان التقرير يقول الصف
   اللي مش متربط شايل مستندات قد إيه):

       SELECT d.Code, d.ID, m.ID, d.Name_Ar, m.Name_Ar, d.Phone,
              (SELECT COUNT(*) FROM wh_transDCoupon c WHERE c.DistributorId = d.ID),
              (SELECT COUNT(*) FROM Wh_TechnicalVisits v WHERE v.MerchantsID = m.ID)
       FROM wh_Distributors d LEFT JOIN wh_Merchants m ON m.Code = d.Code

٢. الورقة «1» من ملف العميل «يا رب-داتا خدمه ع ملاء بكود A5-.xlsx»: عمود «كود موزع»
   (= `Code`) وعمود «كود A5». عمود «عمود1» في نفس الورقة **مش** رقم ثابت — في الصفوف
   القديمة هو الكود وفي الجديدة هو `wh_Distributors.ID`، فمابيتقراش.

الأعمدة: `code · dist_id · merch_id · a5_code · name · phone · coupons · visits`.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

from sqlalchemy import inspect, select

from src.core.db import SessionLocal, engine
from src.models.customer import Customer, CustomerExternalRef

# أعمدة الملف
(B_CODE, B_DIST, B_MERCH, B_A5, B_NAME, B_PHONE, B_COUP, B_VIS) = range(8)

FILENAME = "merchant_bridge.tsv"


def _read_tsv(path: str) -> list[list[str]]:
    """TSV بترويسة. مش `import_a5._read` لأن ده بيفصل على `~` — والملف ده اتعمل بتاب."""
    if not os.path.exists(path):
        raise SystemExit("مافيش ملف الجسر: " + path)
    rows: list[list[str]] = []
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            if i == 0 or not line.strip():          # الترويسة والسطور الفاضية
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
        # الجدول جديد. `create_all` وقت إقلاع الخدمة بيعمله، بس السكربت ممكن يجري قبلها.
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
        wanted: list[tuple[str, Customer, str]] = []   # (المفتاح، الكارت، الاسم القديم)
        no_a5: list[list[str]] = []
        no_card: list[list[str]] = []
        conflicts: list[str] = []
        # كود a5 → الصفوف القديمة اللي بتشاور عليه، عشان التقرير يقول مين بيلمّ مين.
        folded: dict[str, list[list[str]]] = {}

        for r in rows:
            a5 = r[B_A5]
            if not a5:
                no_a5.append(r)
                continue
            target = by_code.get(a5)                  # بالكود بالظبط — مافيش تقريب
            if target is None:
                no_card.append(r)
                continue
            folded.setdefault(a5, []).append(r)
            for prefix, value in (("ERP-D", r[B_DIST]), ("ERP-M", r[B_MERCH])):
                if not value:
                    continue                          # ١٩ موزع مالهمش صف في جدول التجار
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
            # تحقّق بعد الكتابة: كل مفتاح كان مطلوب موجود دلوقتي وعلى الكارت الصح.
            now = {x.ref: x.customer_id for x in db.scalars(select(CustomerExternalRef)).all()}
            bad = [ref for ref, target, _name in wanted if now.get(ref) != target.id]
            print(f"\nاتكتب {len(wanted)} مفتاح — الإجمالي في الجدول {len(now)}.")
            print("✔ كل مفتاح على كارته." if not bad
                  else f"✘ {len(bad)} مفتاح مالحقش يتربط: {bad[:5]}")

        # ---------- اللي محتاج قرار من المكتب ----------
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
