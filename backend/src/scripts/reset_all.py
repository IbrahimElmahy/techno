"""يفضّي القاعدة كلها إلا الدخول والهيكل والإعدادات — عشان سحب a5 يبتدي من صفحة بيضا.

    python -m src.scripts.reset_all              # يعرض بس
    python -m src.scripts.reset_all --yes        # ينفّذ

**الفرق بينه وبين `reset_transactions`:** التاني بيمسح الحركات ويسيب الأطراف والأصناف
وشجرة الحسابات. ده بيمسح **الأطراف والشجرة والمخازن كمان** — وهي بالظبط اللي
اتلخبطت: عملاء a5 وأطراف ERP قعدوا في جدول واحد، والدمج بالاسم خلط اللي مالوش علاقة
باللي له، فالكروت المدموجة بقت مالهاش أصل واضح ولا طريقة تتفك بيها صف صف.

**اللي بيفضل** — أقل حاجة تخلّي النظام يقوم ويتسجّل عليه دخول، وكل إعداد اتظبط
بالإيد ومش موجود في تصدير a5:

    user · role · role_capability · branch · governorate · head_office · territory
    lookup_option · sales_setting · stock_setting · payroll_setting · alembic_version
    department · job_title · cost_center · voucher_key · salary_component
    work_shift · leave_type · holiday · coupon_type · inspection_item_type
    payroll_scheme_version · payroll_scheme_bracket

`governorate` و`territory` بيفضلوا لأن `branch.governorate_id` و`user.territory_id`
بيشاوروا عليهم — والمناطق نفسها `import_a5` بيعيد بناءها بالاسم فوق الموجود.

**اللي بيتمسح:** كل الباقي. الأرصدة كلها مشتقّة من الحركات، فالمسح بيصفّرها لوحده.

---------------------------------------------------------------------------
**ليه مش `TRUNCATE ... CASCADE` زي النسخة الأولى:** `CASCADE` في Postgres **مش**
فحص — هو توسعة: بيمسح كل جدول عنده مفتاح أجنبي على اللي بتمسحه. `user.territory_id`
بيشاور على `territory`، فمسح `territory` بـ`CASCADE` كان هيمسح المستخدمين، والسكربت
اللي اتكتب عشان تفضل تعرف تدخل كان هيقفلك بره. من غير `CASCADE` أي مفتاح من جدول
محفوظ لجدول متمسوح بيرمي خطأ صريح — وده الفحص اللي عايزينه.

**وليه جدولين بيتمسحوا بـ`DELETE` مش `TRUNCATE`:** Postgres بيرفض `TRUNCATE` لجدول
عليه مفتاح أجنبي من جدول بره القايمة **حتى لو كل القيم NULL**. `salary_component`
و`voucher_key` (محفوظين) بيشاوروا على `account`، و`department` بيشاور على `employee`.
فالاتنين دول بيتفضّوا بـ`DELETE` والعدّاد بيترجع بإيدنا — نفس النتيجة، بس بالباب
اللي Postgres بيفتحه. الأعمدة دي بتتصفّر الأول عشان الـ`DELETE` نفسه مايقعش.

⚠️ **حذف نهائي.** خُد `pg_dump` قبله، ووقّف خدمة `TechnoApi`: أول قيد على قاعدة فاضية
بيخلّي `account_resolver` يخترع خزينة وحسابات افتراضية — وده ازدواج الخزينتين اللي
اتصلّح مرة قبل كده. والسكربت بيرفض يشتغل لو التخزين مش Postgres.
"""
from __future__ import annotations

import sys

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text

import src.models  # noqa: F401 — بيملا الـmetadata بكل الجداول
from src.core.db import SessionLocal, engine

# اللي بيفضل. القايمة صغيرة عن قصد: أي جدول مش هنا بيتمسح، فالجدول الجديد اللي حد يضيفه
# بكرة بيتمسح افتراضياً — وده الاتجاه الآمن. الجدول اللي المفروض يفضل بيتحط هنا بالاسم.
KEEP: set[str] = {
    # الدخول والصلاحيات — من غيرهم مافيش حد يقدر يدخل يشغّل السحب أصلاً
    "user", "role", "role_capability",
    # الهيكل الإداري: الفروع بتتنده بالاسم في سكربتات السحب («العلياء»، «أكتوبر»)،
    # والمحافظة والمنطقة مفاتيح على الفرع والمستخدم
    "branch", "governorate", "head_office", "territory",
    # الإعدادات والقوايم المنسدلة — اتظبطت بالإيد ومش موجودة في تصدير a5
    "lookup_option", "sales_setting", "stock_setting", "payroll_setting",
    # إعدادات الموارد البشرية والمحاسبة — تهيئة مش حركة
    "department", "job_title", "cost_center", "voucher_key", "salary_component",
    "work_shift", "leave_type", "holiday", "payroll_scheme_version",
    "payroll_scheme_bracket",
    # قوايم مرجعية لما بعد البيع — الإدخال اليدوي محتاجها
    "coupon_type", "inspection_item_type",
    # جداول الترحيلات/النسخ لو موجودة
    "alembic_version",
}

# أعمدة في جداول محفوظة بتشاور على جداول بتتمسح. بتتصفّر قبل الحذف.
UNLINK = (
    "UPDATE salary_component SET account_id = NULL",
    "UPDATE voucher_key SET debit_account_id = NULL, credit_account_id = NULL",
    "UPDATE department SET manager_employee_id = NULL, cost_center_id = NULL",
    # دوائر ذاتية: `DELETE` بيقع عليها، و`TRUNCATE` لأ. بتتصفّر قبل الحذف.
    "UPDATE account SET parent_id = NULL",
    "UPDATE employee SET warehouse_id = NULL, department_id = NULL",
)


def _all_tables() -> list[str]:
    """أسماء الجداول من **القاعدة نفسها** مش من الموديلز.

    `Base.metadata` بيشيل اللي اتعمل له import بس، و`src/models/__init__.py` ناقصه
    موديلات (اتكشف على `stock_count_line`: موجود في القاعدة ومش في الميتاداتا، فوقع
    الـTRUNCATE بمفتاح أجنبي من جدول مش في القايمة). القاعدة هي الحقيقة الوحيدة
    الكاملة هنا، والقراءة منها معناها إن أي جدول اتعمل بعدين بيتحسب لوحده.
    """
    return sa_inspect(engine).get_table_names()


def _targets() -> list[str]:
    return [t for t in _all_tables() if t not in KEEP]


def _delete_group() -> list[str]:
    """الجداول اللي لازم تتفضّى بـ`DELETE` — مرتّبة: الابن قبل الأب.

    Postgres بيرفض `TRUNCATE` لجدول عليه مفتاح أجنبي من جدول **بره الجملة**، وده
    بيتحقق على القيد نفسه مش على الصفوف: جدول فاضي بيمنع برضه. فالمجموعة دي إغلاق
    مش مستوى واحد:

    * `salary_component`/`voucher_key` (محفوظين) بيشاوروا على `account` → `account`.
    * `department` (محفوظ) بيشاور على `employee` → `employee`.
    * و`employee` نفسه بيشاور على `warehouse` → `warehouse` بيدخل معاهم.

    اتكشفت الحلقة دي بالتجربة: أول محاولة وقعت على `stock_count_line`، والتانية على
    «employee references warehouse». الإغلاق بيمسك الحالة دي كلها لوحده.
    """
    insp = sa_inspect(engine)
    tables = set(_all_tables())
    group: set[str] = set()
    frontier = [t for t in KEEP if t in tables]
    seen_sources: set[str] = set()
    while frontier:
        src = frontier.pop()
        if src in seen_sources:
            continue
        seen_sources.add(src)
        for fk in insp.get_foreign_keys(src):
            ref = fk.get("referred_table")
            if ref and ref not in KEEP and ref not in group:
                group.add(ref)
                frontier.append(ref)

    # ترتيب الحذف: **اللي محدش بيشاور عليه الأول**. `employee` بيشاور على `warehouse`،
    # فـ`employee` بيتمسح قبله — العكس بيقع على المفتاح.
    refs = {t: {fk.get("referred_table") for fk in insp.get_foreign_keys(t)} - {t}
            for t in group}
    order: list[str] = []
    remaining = set(group)
    while remaining:
        free = [t for t in sorted(remaining)
                if not any(t in refs[o] for o in remaining if o != t)]
        if not free:                       # دايرة — بنمشي بالترتيب الأبجدي
            free = sorted(remaining)
        order.extend(free)
        remaining -= set(free)
    return order


def _count(db, name: str) -> int:
    return db.scalar(text(f'SELECT count(*) FROM "{name}"')) or 0


def run(*, execute: bool) -> None:
    if engine.dialect.name != "postgresql":
        print(f"✘ التخزين هنا «{engine.dialect.name}» مش postgresql — وقفت.")
        return

    targets = _targets()
    by_delete = _delete_group()
    by_truncate = [t for t in targets if t not in by_delete]

    db = SessionLocal()
    try:
        counts = {t: _count(db, t) for t in targets}
        counts = {t: n for t, n in counts.items() if n}
        total = sum(counts.values())

        print(f"هيتمسح {total:,} صف من {len(counts)} جدول:\n")
        for t, n in sorted(counts.items(), key=lambda kv: -kv[1])[:30]:
            how = "DELETE  " if t in by_delete else "TRUNCATE"
            print(f"   {how} {t:<34}{n:>10,}")
        if len(counts) > 30:
            print(f"   ... و{len(counts) - 30} جدول تاني")
        print(f"\nبـDELETE (عليهم مفتاح من جدول محفوظ): {'، '.join(by_delete) or '—'}")

        kept_counts = {t: _count(db, t) for t in sorted(KEEP & set(_all_tables()))}
        print("\nهيفضل:")
        for t, n in sorted(kept_counts.items()):
            print(f"   {t:<34}{n:>10,}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for sql in UNLINK:
            db.execute(text(sql))

        # جملة واحدة لكل الجداول: `TRUNCATE` بيقبل قايمة، والمفاتيح الأجنبية اللي بين
        # الجداول دي (والدوائر الذاتية زي `account.parent_id`) مابتعترضش طالما كلهم
        # في نفس الجملة. من غير CASCADE عن قصد — شوف الدوكسترنج.
        quoted = ", ".join(f'"{t}"' for t in by_truncate)
        db.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY"))
        for t in by_delete:
            db.execute(text(f'DELETE FROM "{t}"'))
            db.execute(text(
                f"SELECT setval(pg_get_serial_sequence('\"{t}\"', 'id'), 1, false)"))
        db.commit()

        left = sum(_count(db, t) for t in targets)
        print(f"\n✔ اتمسح. الفاضل في الجداول دي: {left}")
        bad = 0
        for t, n in sorted(kept_counts.items()):
            now = _count(db, t)
            mark = "✔" if now == n else "✘"
            bad += now != n
            print(f"{mark} {t}: {now} (كان {n})")
        if bad or left:
            print("\n✘ حاجة اتغيّرت مش المفروض تتغيّر — راجع قبل أي استيراد.")
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
