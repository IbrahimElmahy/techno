"""يحطّ كل مندوب على المخزن اللي فواتيره سحبت منه فعلاً — مش اللي اسمه شبهه.

    python -m src.scripts.fix_rep_warehouses_2          # يعرض بس
    python -m src.scripts.fix_rep_warehouses_2 --yes    # ينفّذ

**الموجة التانية.** `fix_rep_warehouses` صلّح مناديب السيارات الخمسة (أ/ب/ج/د/الشرقية)
والخمسة دول اتأكدوا تاني هنا وطلعوا سليمين: مخزن الكارت هو نفسه اللي الفواتير سحبت منه.
الباقي لسه مزحلق، وبنفس السبب: المطابقة بالاسم.

**المقياس هنا مش الاسم — الحركات.** لكل مندوب، جمعنا حركات المخزون المربوطة بفواتيره
(`source_doc_type = 'sales_invoice'`) وشُفنا خرجت من أنهي مكان. ده كلام a5 نفسه، منقول
زي ما هو، ومالوش علاقة بالتسمية:

    المندوب              الكارت بيقول            الفواتير سحبت من            النسبة
    ────────────────────────────────────────────────────────────────────────────────
    مندوبية الفيوم       مخزن سياره ٢            مخزن سياره ١   ٣٬٠٦٨       ٩٩٪
    عمرو رجب             مخزن عمرو رجب (١٩)      مخزن سياره ٢   ٤٬٨٨٠       ٨٥٪
    مندوبية الحرفيين     مخزن مندوبية الحرفيين   مخزن سياره ٢     ٥٦٦       ٩٩٪
    مندوبية الجيزة٢      مخزن مندوبية الجيزة٢    مخزن سياره ٢     ١٩٠       ٩٩٪
    rep                  مخزن سياره ١            مخزن اكتوبر       ٧٦       ٤٩٪
    ادارة الفروع         — مالوش —               المخزن الرئيسى   ٣٨٩       ٧٢٪
    اداره مبيعات         — مالوش —               المخزن الرئيسى   ٣٣٠       ٨٥٪

الزحلقة بتتقرا من الجدول: «مخزن سياره ١» متسجّل على `rep` واللي بيبيع منه فعلاً
**الفيوم**؛ و«مخزن سياره ٢» متسجّل على **الفيوم** واللي بيبيع منه فعلاً **عمرو رجب**.
سلسلة إزاحة بمقدار خانة — نفس الشكل اللي كان في مناديب السيارات.

**والأثر إن الراجل مايقدرش يبيع.** `rep_store_service.rep_store` بيقرا
`employee.warehouse_id` عشان يعرف المندوب بيبيع منين، والتطبيق بيسحب أصناف المكان ده.
فعمرو رجب — ٢٣٠ عميل و٩٤٤ فاتورة — بيفتح التطبيق فيلاقي «مخزن عمرو رجب» وفيه **١٩
حركة**، وبضاعته الحقيقية (٤٬٨٨٠ حركة) في مخزن باسم حد تاني. والحرفيين والجيزة٢
مخازنهم **صفر حركة** خالص.

**المخزن الواحد ينفع لأكتر من مندوب، وده مقصود.** تلاتة بيسحبوا من «مخزن سياره ٢»:
عمرو رجب (٤٬٨٨٠) والحرفيين (٥٦٦) والجيزة٢ (١٩٠). ده اللي a5 بيقوله، والموديل عندنا
بيسمح بيه — `employee.warehouse_id` مافيهوش قيد تفرّد، و`rep_store` بيقرا الصف
مباشرةً. الإصرار على «مخزن لكل واحد» كان هيخلّي اتنين منهم على مخازن فاضية عشان
يحافظ على قاعدة النظام ماطلبهاش.

**اللي مابيتلمسش:**

* **مناديب السيارات الخمسة** — اتقاسوا وطلعوا مظبوطين، فبيتخطّوا.
* **اللي مالوش ولا فاتورة**: مندوبية الجيزة١ (٥١ عميل)، المنيا (١٢)، المنصورة (٢)،
  عمرو مصطفى ٢ (٢٣). مافيش حركة واحدة نقيس عليها، والتخمين هنا هو نفس الغلطة اللي
  بنصلّحها. دول محتاجين قرار من المكتب: مخزن مين، ولا مقفولين أصلاً.
* **ولا حركة مخزون ولا فاتورة ولا قيد.** الربط بس. اللي اتباع من مخزن قبل كده اتباع
  منه فعلاً، والدفتر بيحكي اللي حصل — الإصلاح ده بيخلّي **الجاي** يمشي صح.

بيتعاد تشغيله بأمان: اللي مظبوط بيتخطى.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.sales import SalesInvoice
from src.models.stock import StockMovement
from src.models.user import User
from src.models.warehouse import Warehouse

# اسم الدخول → اسم المخزن بالظبط. صريح بالكود لأن اللي غلط أصلاً هو التقريب الآلي:
# المطابقة بالاسم هي اللي حطّت الفيوم على «سياره ٢» وrep على «سياره ١».
#
# كل سطر هنا مقيس من الحركات، والنسبة جنبه هي حصة المخزن ده من حركات بيع المندوب.
PAIRS: list[tuple[str, str, str]] = [
    ("fayoum", "مخزن سياره 1", "٣٬٠٦٨ حركة · ٩٩٪"),
    ("amr.ragab", "مخزن سياره 2", "٤٬٨٨٠ حركة · ٨٥٪"),
    ("herafyeen", "مخزن سياره 2", "٥٦٦ حركة · ٩٩٪"),
    ("giza2", "مخزن سياره 2", "١٩٠ حركة · ٩٩٪"),
    # مكتب مش عربية — بيبيعوا من المخزن الرئيسى، وده اللي حركاتهم بتقوله.
    ("branches", "المخزن الرئيسى", "٣٨٩ حركة · ٧٢٪"),
    ("sales.dept2", "المخزن الرئيسى", "٣٣٠ حركة · ٨٥٪"),
]

# بيتفكّ منهم المخزن: ماسكين مخزن حد تاني، وحركاتهم هما مش فيه.
#
# `rep` هو المستخدم اللي إحنا عملناه للتجربة، وماسك «مخزن سياره ١» — مخزن الفيوم
# الحقيقي بـ٩٬٢٣٨ حركة. حركاته هو (٧٦) في «مخزن اكتوبر»، وهي قليلة ومتفرقة على أربع
# مخازن، فمافيش مخزن نقدر نقول إنه بتاعه. الفكّ أصدق من نسبة مخزن لحد على ٤٩٪.
UNLINK: list[str] = ["rep"]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        def real_source(user_id: int) -> tuple[str, int, int]:
            """أعلى مكان سحبت منه فواتير المندوب: (الاسم، عدد الحركات، النسبة)."""
            rows = db.execute(
                select(StockMovement.location_id, func.count())
                .join(SalesInvoice, SalesInvoice.id == StockMovement.source_doc_id)
                .where(SalesInvoice.rep_id == user_id,
                       StockMovement.source_doc_type == "sales_invoice",
                       StockMovement.location_kind == "warehouse")
                .group_by(StockMovement.location_id)
                .order_by(func.count().desc())).all()
            if not rows:
                return ("— مافيش حركات —", 0, 0)
            total = sum(n for _lid, n in rows) or 1
            top_id, top_n = rows[0]
            w = db.get(Warehouse, top_id)
            return (w.name if w else f"#{top_id}", top_n, top_n * 100 // total)

        plan: list[tuple[Employee, User, Warehouse, Warehouse | None, str]] = []
        problems: list[str] = []

        for username, wh_name, measured in PAIRS:
            u = db.scalar(select(User).where(User.username == username))
            whs = db.scalars(select(Warehouse).where(Warehouse.name == wh_name)).all()
            if u is None or len(whs) != 1:
                problems.append(f"«{username}» → «{wh_name}»: "
                                f"{'مافيش مستخدم' if u is None else f'{len(whs)} مخزن'}")
                continue
            emp = db.scalar(select(Employee).where(Employee.user_id == u.id))
            if emp is None:
                problems.append(f"«{username}»: مالوش كارت موظف — الربط بيتكتب عليه")
                continue
            wh = whs[0]
            # الحارس: الجدول فوق مقيس، فالسكربت بيعيد القياس قبل ما يكتب. لو الحركات
            # قالت حاجة تانية دلوقتي، يبقى الجدول بايت — وبيتقال مش بيتنفّذ.
            real_name, n, pct = real_source(u.id)
            if real_name != wh_name:
                problems.append(f"«{username}»: الجدول بيقول «{wh_name}» "
                                f"والحركات دلوقتي بتقول «{real_name}» ({n}) — اتخطّى")
                continue
            if emp.warehouse_id == wh.id:
                continue
            old = db.get(Warehouse, emp.warehouse_id) if emp.warehouse_id else None
            plan.append((emp, u, wh, old, f"{n} حركة · {pct}٪"))

        unlink: list[tuple[Employee, User, Warehouse]] = []
        for username in UNLINK:
            u = db.scalar(select(User).where(User.username == username))
            if u is None:
                continue
            emp = db.scalar(select(Employee).where(Employee.user_id == u.id))
            if emp is not None and emp.warehouse_id:
                w = db.get(Warehouse, emp.warehouse_id)
                if w is not None:
                    unlink.append((emp, u, w))

        print(f"{'المندوب':<16}{'من':<24}{'إلى':<22}{'المقاس من الحركات'}")
        print("-" * 84)
        for emp, u, wh, old, measured in plan:
            print(f"{u.username:<16}{(old.name if old else '—')[:22]:<24}"
                  f"{wh.name[:20]:<22}{measured}")
        print(f"\nهيتصلّح: {len(plan)}")

        if unlink:
            print(f"\nهيتفكّ منهم المخزن ({len(unlink)}) — ماسكين مخزن حد تاني:")
            for emp, u, w in unlink:
                real_name, n, pct = real_source(u.id)
                print(f"   {u.username:<16}كان على «{w.name}»   "
                      f"وحركاته في «{real_name}» ({n} · {pct}٪)")

        if problems:
            print(f"\n⚠️ مش هيتغيّروا ({len(problems)}):")
            for p in problems:
                print(f"   {p}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        # الفكّ الأول: «مخزن سياره ١» لازم يسيب `rep` قبل ما الفيوم ياخده. مش لأن فيه
        # قيد يمنع — مافيش — لكن عشان اللحظة اللي الاتنين فيها عليه ماتحصلش أصلاً.
        for emp, _u, _w in unlink:
            emp.warehouse_id = None
        db.flush()
        for emp, _u, wh, _old, _m in plan:
            emp.warehouse_id = wh.id
        db.commit()

        print("\nبعد التصحيح:")
        for username, wh_name, _m in PAIRS:
            u = db.scalar(select(User).where(User.username == username))
            emp = db.scalar(select(Employee).where(Employee.user_id == u.id)) if u else None
            w = db.get(Warehouse, emp.warehouse_id) if emp and emp.warehouse_id else None
            n = db.scalar(
                select(func.count()).select_from(StockMovement)
                .where(StockMovement.location_id == w.id,
                       StockMovement.location_kind == "warehouse")) if w else 0
            mark = "✔" if w and w.name == wh_name else "✘"
            print(f"{mark} {username:<16}{(w.name if w else '—')[:22]:<24}"
                  f"{n or 0:>7} حركة في المخزن")
        for _emp, u, _w in unlink:
            e = db.scalar(select(Employee).where(Employee.user_id == u.id))
            print(f"✔ {u.username:<16}"
                  f"{'اتفكّ' if e and e.warehouse_id is None else '⚠ لسه مربوط'}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
