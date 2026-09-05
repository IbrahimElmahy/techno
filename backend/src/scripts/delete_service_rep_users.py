"""يمسح يوزرات مناديب الخدمة اللي اتعملوا من نقل `ERP` — بقرار المستخدم.

    python -m src.scripts.delete_service_rep_users          # يعرض بس
    python -m src.scripts.delete_service_rep_users --yes    # ينفّذ

بيتعاد تشغيله بأمان: اللي اتمسح خلاص مابيتلقاش، والباقي بيتفحص من جديد.

---------------------------------------------------------------------------
**ليه:** `import_erp_parties` عمل ١٦ يوزر من جدول مناديب `ERP`، ١٠ منهم مالهمش وجود
في a5 — دول مناديب ما بعد البيع. قاعدة `ERP` اتقفلت نهائياً كمصدر، وما بعد البيع
هييجي من ملف جديد، والمستخدم قال: يتمسحوا ويتعملوا من جديد مع الملف.

**بالاسم الكامل مش بالرقم.** `simplify_usernames` غيّر الـusernames بعد ما اتعملوا،
والأرقام بتتغيّر مع كل إعادة بناء. الاسم الكامل هو اللي ثابت.

**مايتمسحش غير الفاضي.** السكربت بيلف على **كل** مفتاح أجنبي بيشاور على `user.id` في
الـmetadata — مش قايمة مكتوبة بالإيد — وبيعدّ. أعمدة الإعداد (مين آخر واحد عدّل
الإعدادات، مين عمل مفتاح السند) بتتصفّر لأنها أثر مش ملكية. أي عمود تاني فيه صف
واحد = اليوزر ده شغّال في حاجة، والسكربت بيرفض ويقول فين. عشان كده بيتشغّل **بعد**
`reset_all`: المعاينات والكوبونات اللي كانت بتشاور عليهم بتكون اتمسحت.
"""
from __future__ import annotations

import sys
from collections import Counter

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text

from src.core.db import SessionLocal, engine
from src.models.user import User

# مناديب الخدمة اللي جم من ERP — بالاسم الكامل زي ما هو في `user.full_name`.
TARGET_NAMES = (
    "اشرف هلول", "ابراهيم خطاب", "انس سعيد", "محمد ممدوح", "مدحت خضر",
    "احمد تركى", "محمد تركى", "بيومى جابر", "حسن عيد", "اداره خدمه عملاء",
)

# أعمدة «مين عمل ده» على جداول إعداد — أثر مش ملكية، بتتصفّر بدل ما تمنع الحذف.
NULLABLE_TRACE = {
    ("voucher_key", "created_by"),
    ("sales_setting", "updated_by"),
    ("stock_setting", "updated_by"),
    ("payroll_setting", "actor_user_id"),
    ("role_capability", "actor_user_id"),
    ("payroll_scheme_version", "actor_user_id"),
}


def _clean(s: str) -> str:
    return " ".join((s or "").split())


def _user_fk_columns() -> list[tuple[str, str, bool]]:
    """(جدول، عمود، nullable) لكل مفتاح أجنبي على `user.id` — **من القاعدة**.

    مش من `Base.metadata`: الميتاداتا بتشيل الموديلات اللي اتعمل لها import بس،
    و`src/models/__init__.py` ناقصه حاجات (`coupon_issue` مثلاً) — فقراءة المفاتيح
    منها بترمي `NoReferencedTableError` أو، أسوأ، بتفوّت عمود بيشاور على اليوزر
    وتخلّي الحذف يقع على قيد في نص الشغل.
    """
    insp = sa_inspect(engine)
    out = []
    for tbl in insp.get_table_names():
        nullable = {c["name"]: bool(c.get("nullable", True))
                    for c in insp.get_columns(tbl)}
        for fk in insp.get_foreign_keys(tbl):
            if fk.get("referred_table") != "user":
                continue
            for i, ref_col in enumerate(fk.get("referred_columns") or []):
                if ref_col != "id":
                    continue
                col = fk["constrained_columns"][i]
                out.append((tbl, col, nullable.get(col, True)))
    return sorted(set(out))


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        wanted = {_clean(n) for n in TARGET_NAMES}
        users = [u for u in db.scalars(select(User)).all()
                 if _clean(u.full_name or "") in wanted]
        found = {_clean(u.full_name or "") for u in users}
        print(f"مطلوب {len(wanted)} · لقيت {len(users)}")
        for n in sorted(wanted - found):
            print(f"   (مش موجود — اتمسح قبل كده؟) {n}")
        if not users:
            print("مافيش حاجة تتعمل.")
            return
        ids = [u.id for u in users]

        blocking: Counter = Counter()
        tracing: Counter = Counter()
        for tbl, col, nullable in _user_fk_columns():
            n = db.execute(text(f'SELECT count(*) FROM "{tbl}" WHERE "{col}" = ANY(:i)'),
                           {"i": ids}).scalar() or 0
            if not n:
                continue
            if (tbl, col) in NULLABLE_TRACE and nullable:
                tracing[f"{tbl}.{col}"] = n
            else:
                blocking[f"{tbl}.{col}"] = n

        print("\nهيتمسح:")
        for u in users:
            print(f"   #{u.id:<4} {u.username:<20} «{u.full_name}» active={u.active}")
        if tracing:
            print("\nأعمدة أثر هتتصفّر:")
            for k, v in tracing.most_common():
                print(f"   {k:<40}{v:>6}")
        if blocking:
            print("\n✘ اليوزرات دول لسه مستخدمين — مش هيتمسحوا:")
            for k, v in blocking.most_common():
                print(f"   {k:<40}{v:>6}")
            print("شغّل reset_all الأول، أو راجع الصفوف دي بإيدك.")
            sys.exit(1)

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for key in tracing:
            tbl, col = key.split(".")
            db.execute(text(f'UPDATE "{tbl}" SET "{col}" = NULL WHERE "{col}" = ANY(:i)'),
                       {"i": ids})
        db.execute(text('DELETE FROM "user" WHERE id = ANY(:i)'), {"i": ids})
        db.commit()
        left = [u for u in db.scalars(select(User)).all()
                if _clean(u.full_name or "") in wanted]
        print(f"\n✔ اتمسح {len(users)} يوزر. الفاضل بنفس الأسماء: {len(left)}")
        if left:
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
