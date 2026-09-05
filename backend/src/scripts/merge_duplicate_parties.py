"""يلمّ الشخص الواحد المتسجّل كارتين — كارت a5 وكارت ما بعد البيع.

    python -m src.scripts.merge_duplicate_parties --dir C:/pgtmp/erp/wb          # يعرض بس
    python -m src.scripts.merge_duplicate_parties --dir C:/pgtmp/erp/wb --yes    # ينفّذ

بيتعاد تشغيله بأمان: اللي اتدمج قبل كده بيتعدّى، والقياس بيتعمل من جديد كل مرة.

---------------------------------------------------------------------------
**الشخص كارت واحد — والدور مش طرف.**

التاجر ممكن يشتري سخّان ويركّبه في بيته، فيبقى هو نفسه اللي محتاج الدعم الفني.
ده **مايعملش طرف تاني**: `inspection` عندها تلات خانات مختلفة للتلات أدوار —
`merchant_customer_id` (اشترى منه)، و`customer_id` (اللي اتزار)، و`owner_id`
(صاحب البيت). فنفس الكارت بيظهر تاجر على معاينات زباينه، وعميل على معاينة بيته،
في نفس اللحظة. والتصنيف بيفضل «تاجر» لأنه العلاقة التجارية؛ كونه مالك جهاز
حقيقة خدمة مش هوية تانية.

اللي عندنا مش الحالة دي. النقل عمل **كارتين لنفس الراجل** لأنه قرا من قاعدتين
من غير جسر: كارت `AL-A5-…` من a5 شايل الفواتير والدفتر، وكارت `ERP-P-…` من
ما بعد البيع. والجسر بينهم موجود في ملف العميل — عمود «كود A5» في صفحة «سباك»،
اللي العميل ملاه بإيده على ٤١ صف.

**ليه ده مش شغل `customer_merge_service`:** الخدمة دي مبنية لشكل تاني — «تكنو
فلان» و«فلان»، راجل واحد بحسابين ذمم (أبيض وبولي)، وشغلها إنها تحطّ الحسابين
تحت كارت واحد. هنا الكارت التاني **مالوش حساب أصلاً**، فتشغيلها بيدوّر على
حاجة مش موجودة.

**اللي اتقاس على الـ٣٤ زوج، جدول جدول:**

    sales_invoice        ERP-P = ٠      AL-A5 = ١٬٠١٨
    sales_return         ERP-P = ٠      AL-A5 =    ٣٢
    customer_account     ERP-P = ٠      AL-A5 =    ٨٠
    inspection           ERP-P = ٠      AL-A5 = ١٬٢٣٣
    coupon / voucher / cheque / trade_order / reservation / points … كلها صفر

يعني **الكارت الزيادة فاضي تماماً**. مافيش صف واحد بيشاور عليه. فالدمج هنا مش
نقل داتا — هو تسجيل هوية وقفل كارت. بس السكربت بيعدّ الصفوف على الناحيتين قبل
ما يعمل أي حاجة، ولو لقى الكارت الزيادة شايل حاجة **بينقلها بالاسم** جدول جدول
بدل ما يفترض إنه فاضي — عشان يفضل صح لما نيجي ندمج `ERP-M`/`ERP-D` بعدين.

**الكود بيتسجّل مش بيتمسح.** `ERP-P-<n>` بيتحط في `customer_external_ref`،
فأي استيراد جاي للمعاينات أو الكوبونات بيدوّر بالكود القديم بيلاقي الكارت
الصح بدل ما يعمل واحد جديد ونرجع لنفس المشكلة.

**والكارت الزيادة بيتعطّل مش بيتمسح.** لو فضلت أي إشارة قديمة عليه في أي مكان،
تلاقي اسم — مش رقم ضايع.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text

from src.core.db import SessionLocal, engine
from src.models.customer import Customer

F_PLUMBERS = "wb_plumbers.tsv"
F_BRIDGE = "wb_bridge.tsv"

# كل خانة بتشاور على عميل، بالاسم. مافيش `cascade` هنا عن قصد: النقل بيتكتب
# صريح عشان أي جدول جديد يظهر في التقرير كـ«مش متعامل معاه» بدل ما يتنقل بالصدفة.
REFS: tuple[tuple[str, str], ...] = (
    ("sales_invoice", "customer_id"),
    ("sales_return", "customer_id"),
    ("voucher", "customer_id"),
    ("cheque", "customer_id"),
    ("trade_order", "customer_id"),
    ("reservation", "customer_id"),
    ("coupon_issue", "customer_id"),
    ("coupon_receipt", "customer_id"),
    ("inspection", "customer_id"),
    ("inspection", "merchant_customer_id"),
    ("customer_account", "customer_id"),
    ("customer_contact", "customer_id"),
    ("customer_external_ref", "customer_id"),
    ("point_ledger", "customer_id"),
    ("point_balance", "customer_id"),
    ("loyalty_point", "customer_id"),
)


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش ملف {path} — صدّر صفحات ملف العميل الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, F_PLUMBERS))
    # (كود الكارت الزيادة، كود الكارت الباقي، الاسم زي ما هو في الشيت)
    pairs: dict[str, tuple[str, str]] = {}
    for r in rows:
        if r.get("kind") == "تاجر" and r.get("a5_code", "").startswith(("A5-", "AL-A5-")):
            pairs[f"ERP-P-{r['code']}"] = (r["a5_code"], r["name"])
    n_plumb = len(pairs)

    # الجسر التاني، مبني من نفس الملف: صفحة «كوبونات» فيها «كود تاجر» جنب «كود
    # تاجر A5» على ١٩٬٦٣٥ صف، وصفحة «معاينات» فيها `MerchantsID` جنب «كود تاجر»
    # على ١٠٬٧٢٦. يعني العميل كاتب الترجمة بإيده جوّه الحركة نفسها — أقوى من أي
    # مطابقة أسماء، والصفحات المرقّمة (`0`/`1`/`2`) مالهاش لزوم.
    for r in _read(os.path.join(folder, F_BRIDGE)):
        pairs.setdefault(r["erp_code"], (r["a5_code"], ""))
    print(f"صفحة «سباك»: {len(rows)} صف · منهم «تاجر» بكود a5: {n_plumb}")
    print(f"الجسر من صفحتَي الكوبونات والمعاينات: {len(pairs) - n_plumb} مفتاح زيادة")
    pairs = [(k, v[0], v[1]) for k, v in pairs.items()]

    insp = sa_inspect(engine)
    tables = set(insp.get_table_names())
    refs = [(t, c) for t, c in REFS
            if t in tables and c in {x["name"] for x in insp.get_columns(t)}]
    skipped_tables = [f"{t}.{c}" for t, c in REFS if (t, c) not in refs]
    if skipped_tables:
        print("   جداول مش موجودة في القاعدة دي:", "، ".join(skipped_tables))

    db = SessionLocal()
    try:
        codes = {c for p in pairs for c in p[:2]}
        by_code = {c.code: c for c in db.scalars(
            select(Customer).where(Customer.code.in_(codes))).all()}

        plan: list[tuple[Customer, Customer, dict[str, int]]] = []
        notes: Counter = Counter()
        problems: list[str] = []

        for dup_code, keep_code, name in pairs:
            dup, keep = by_code.get(dup_code), by_code.get(keep_code)
            if keep is None:
                notes["كارت a5 مش عندنا — مش دمج"] += 1
                continue
            if dup is None:
                notes["الكارت الزيادة مش موجود (اتدمج قبل كده أو عمره ما اتعمل)"] += 1
                continue
            if dup.id == keep.id:
                notes["نفس الكارت"] += 1
                continue

            counts = {}
            for t, col in refs:
                n = db.execute(text(f"SELECT count(*) FROM {t} WHERE {col} = :i"),
                               {"i": dup.id}).scalar() or 0
                if n:
                    counts[f"{t}.{col}"] = n

            # الحارس: الاتنين عليهم فواتير يبقى ده مش كارت زيادة — ده احتمال
            # راجلين مختلفين اتلموا بالغلط. الحالة دي بتتقال ومابتتنفذش.
            keep_inv = db.execute(text(
                "SELECT count(*) FROM sales_invoice WHERE customer_id = :i"),
                {"i": keep.id}).scalar() or 0
            if counts.get("sales_invoice.customer_id") and keep_inv:
                problems.append(
                    f"{dup_code} «{dup.name}» ↔ {keep_code} «{keep.name}»: "
                    f"الاتنين عليهم فواتير ({counts['sales_invoice.customer_id']} و{keep_inv}) "
                    "— مش تكرار مؤكد، اتخطّى")
                continue
            plan.append((dup, keep, counts))

        print(f"\nالخطة: {len(plan)} زوج")
        moved: Counter = Counter()
        for _, _, counts in plan:
            for k, v in counts.items():
                moved[k] += v
        if moved:
            print("   صفوف هتتنقل:")
            for k, v in moved.most_common():
                print(f"      {k:<40}{v:>7}")
        else:
            print("   صفوف هتتنقل: **صفر** — الكارت الزيادة فاضي في كل الجداول.")

        print("\n   عيّنة:")
        for dup, keep, counts in plan[:8]:
            extra = ("، ".join(f"{k}={v}" for k, v in counts.items())) or "فاضي"
            print(f"      #{dup.id} {dup.code:<16} «{dup.name[:24]:<24}» → "
                  f"#{keep.id} {keep.code:<12} ({extra})")

        for k, v in notes.most_common():
            print(f"\n   {k}: {v}")
        if problems:
            print(f"\nمحتاج مراجعة ({len(problems)}):")
            for p in problems[:20]:
                print("   ", p)

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        done = 0
        for dup, keep, counts in plan:
            for t, col in refs:
                if f"{t}.{col}" not in counts:
                    continue
                db.execute(text(f"UPDATE {t} SET {col} = :k WHERE {col} = :d"),
                           {"k": keep.id, "d": dup.id})
            # الكود القديم بيتسجّل عشان أي استيراد جاي يلاقي الكارت الصح.
            exists = db.execute(text(
                "SELECT count(*) FROM customer_external_ref WHERE ref = :r"),
                {"r": dup.code}).scalar()
            if not exists and dup.code:
                db.execute(text(
                    "INSERT INTO customer_external_ref (system, ref, customer_id, source_name)"
                    " VALUES ('erp', :r, :c, :n)"),
                    {"r": dup.code, "c": keep.id, "n": dup.name})
            # التاجر بياخد خدمة برضه — مندوب الخدمة بينتقل لو الباقي فاضي.
            if keep.service_rep_id is None and dup.service_rep_id is not None:
                keep.service_rep_id = dup.service_rep_id
            if not keep.phone and dup.phone:
                keep.phone = dup.phone
            dup.active = False
            dup.rep_id = None
            done += 1
        db.commit()
        print(f"\nاتنفّذ: {done} زوج اتلمّ، {sum(moved.values())} صف اتنقل، "
              f"{done} كارت اتعطّل (مااتمسحش).")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = "C:/pgtmp/erp/wb"
    if "--dir" in args:
        folder = args[args.index("--dir") + 1]
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
