"""يفضّي القاعدة كلها إلا الدخول والإعدادات — عشان سحب a5 يبتدي من صفحة بيضا.

    python -m src.scripts.reset_all              # يعرض بس
    python -m src.scripts.reset_all --yes        # ينفّذ

**الفرق بينه وبين `reset_transactions`:** التاني بيمسح الحركات ويسيب الأطراف والأصناف
وشجرة الحسابات. ده بيمسح **الأطراف كمان** — وهي بالظبط اللي اتلخبطت: عملاء a5 وأطراف
ERP (تجار وسباكين وملّاك) قعدوا في جدول واحد، والدمج بالاسم خلط اللي مالوش علاقة باللي
له، فالكروت المدموجة بقت مالهاش أصل واضح ولا طريقة تتفك بيها صف صف.

**اللي بيفضل** — أقل حاجة تخلّي النظام يقوم ويتسجّل عليه دخول:

    user · role · role_capability · branch · head_office
    lookup_option · sales_setting · stock_setting

**اللي بيتمسح:** كل الباقي. الأرصدة كلها مشتقّة من الحركات، فالمسح بيصفّرها لوحده.

⚠️ **حذف نهائي.** خُد `pg_dump` قبله. والسكربت بيرفض يشتغل لو التخزين مش Postgres:
`TRUNCATE ... CASCADE` بيتصرّف بشكل تاني على محركات تانية.
"""
from __future__ import annotations

import sys

from sqlalchemy import func, select, text

import src.models  # noqa: F401 — بيملا الـmetadata بكل الجداول
from src.core.db import Base, SessionLocal, engine

# اللي بيفضل. القايمة صغيرة عن قصد: أي جدول مش هنا بيتمسح، فالجدول الجديد اللي حد يضيفه
# بكرة بيتمسح افتراضياً — وده الاتجاه الآمن. الجدول اللي المفروض يفضل بيتحط هنا بالاسم.
KEEP: set[str] = {
    # الدخول والصلاحيات — من غيرهم مافيش حد يقدر يدخل يشغّل السحب أصلاً
    "user", "role", "role_capability",
    # الهيكل الإداري: الفروع بتتنده بالاسم في سكربتات السحب («العلياء»، «أكتوبر»)
    "branch", "head_office",
    # الإعدادات والقوايم المنسدلة — اتظبطت بالإيد ومش موجودة في تصدير a5
    "lookup_option", "sales_setting", "stock_setting",
    # جداول الترحيلات/النسخ لو موجودة
    "alembic_version",
}


def _targets() -> list[str]:
    return [t for t in Base.metadata.tables if t not in KEEP]


def run(*, execute: bool) -> None:
    if engine.dialect.name != "postgresql":
        print(f"✘ التخزين هنا «{engine.dialect.name}» مش postgresql — وقفت.")
        return

    targets = _targets()
    db = SessionLocal()
    try:
        counts: dict[str, int] = {}
        for t in targets:
            n = db.scalar(select(func.count()).select_from(Base.metadata.tables[t])) or 0
            if n:
                counts[t] = n
        total = sum(counts.values())

        print(f"هيتمسح {total:,} صف من {len(counts)} جدول:\n")
        for t, n in sorted(counts.items(), key=lambda kv: -kv[1])[:30]:
            print(f"   {t:<34}{n:>10,}")
        if len(counts) > 30:
            print(f"   ... و{len(counts) - 30} جدول تاني")

        kept_counts = {
            t: db.scalar(select(func.count()).select_from(Base.metadata.tables[t])) or 0
            for t in KEEP if t in Base.metadata.tables
        }
        print("\nهيفضل:")
        for t, n in sorted(kept_counts.items()):
            print(f"   {t:<34}{n:>10,}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        # جملة واحدة لكل الجداول: `TRUNCATE` بيقبل قايمة، والمفاتيح الأجنبية اللي بين
        # الجداول دي مابتعترضش طالما كلهم في نفس الجملة. و`CASCADE` هنا **مش** توسعة:
        # هو بس بيسمح بالمفاتيح اللي جوّه المجموعة. لو جدول محفوظ بيشاور على واحد
        # متمسوح، بوستجرس بيرفض الجملة كلها — وده الفحص اللي عايزينه، مش مفاجأة.
        quoted = ", ".join(f'"{t}"' for t in targets)
        db.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"))
        db.commit()

        left = sum(
            db.scalar(select(func.count()).select_from(Base.metadata.tables[t])) or 0
            for t in targets
        )
        print(f"\n✔ اتمسح. الفاضل في الجداول دي: {left}")
        for t, n in sorted(kept_counts.items()):
            now = db.scalar(select(func.count()).select_from(Base.metadata.tables[t])) or 0
            mark = "✔" if now == n else "✘"
            print(f"{mark} {t}: {now} (كان {n})")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
