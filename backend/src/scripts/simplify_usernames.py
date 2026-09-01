"""يبسّط أسماء الدخول — من عربي متكتب بحروف إنجليزي وأكواد أرقام لأسماء بيتفتكروا.

    python -m src.scripts.simplify_usernames          # يعرض الاقتراح بس
    python -m src.scripts.simplify_usernames --yes    # ينفّذ

النقل من a5 ولّد الأسماء أوتوماتيك بطريقتين، والاتنين مش صالحين للاستعمال:

    rep.mndwb.syarh.alshrqyh   ← «مندوب سياره الشرقيه» متكتبة بحروف إنجليزي
    svc.10023                  ← كود المندوب في a5، مالوش أي معنى

المندوب بيكتب الاسم ده على شاشة تليفون كل يوم. ٢٤ حرف من عربي محوّل محدش بيفتكرها،
وبيكتبها غلط فيفتكر إن الحساب مقفول.

**الخريطة صريحة مش مولّدة.** الاشتقاق الأوتوماتيكي من الاسم العربي بيدّي حاجة زي
`mndwb.byaa.mhmd.sbhy` — نفس المشكلة بشكل تاني. والأسماء هنا مكتوبة بالإيد عشان
تتقرا وتتعدّل: أول اسم الشخص لما يكون شخص، والمكان لما تكون مندوبية.

**كلمات السر مابتتغيّرش** — الاسم بس. واللي بيغيّر لازم يقول للمندوب اسمه الجديد.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.user import User

# المفتاح رقم المستخدم مش اسمه: الرقم ثابت، والاسم هو اللي بيتغيّر. لو السكربت
# اتشغّل مرتين، التانية مالهاش أثر لأن الاسم بقى المطلوب خلاص.
RENAMES: dict[int, str] = {
    # ── مناديب السيارات (العلياء) ──
    17: "car.a",           # مندوب السياره ( أ )
    15: "car.b",           # مندوب السياره ( ب )
    18: "car.g",           # مندوب السياره ( ج )
    16: "car.d",           # مندوب السياره (د)
    19: "car.sharqia",     # مندوب سياره الشرقيه
    # ── المندوبيات (أكتوبر) — المكان هو الاسم ──
    7: "fayoum",           # مندوبية الفيوم
    8: "herafyeen",        # مندوبية الحرفيين
    9: "giza1",            # مندوبية الجيزة 1
    10: "giza2",           # مندوبية الجيزة2
    13: "minya",           # مندوبية المنيا
    14: "mansoura",        # مندوبية المنصورة
    # ── إدارات ──
    12: "sales.dept",      # ادارة المبيعات
    20: "sales.dept2",     # اداره مبيعات
    52: "sales.dept3",     # مندوب اداره مبيعات
    21: "branches",        # ادارة الفروع
    54: "care",            # اداره خدمه عملاء
    # ── أشخاص — الاسم الأول، والتاني بس لما يبقى فيه أكتر من واحد بنفس الاسم ──
    6: "amr.ragab",        # عمرو رجب
    11: "amr.mostafa",     # عمرو مصطفى 2
    43: "mohamed.sobhy",   # مندوب بيع محمد صبحى
    45: "mohamed.makram",  # مندوب بيع محمد مكرم
    55: "mohamed.mamdouh",  # محمد ممدوح
    58: "mohamed.torky",   # محمد تركى
    44: "ibrahim.hassouna",  # مندوب بيع إبراهيم حسونه
    48: "ibrahim.khattab",  # ابراهيم خطاب
    46: "ahmed.komy",      # مندوب بيع احمد الكومى
    53: "ahmed.torky",     # احمد تركى
    47: "ashraf",          # اشرف هلول
    49: "anas",            # انس سعيد
    50: "bayoumy",         # بيومى جابر
    51: "hassan.eid",      # حسن عيد
    56: "medhat",          # مدحت خضر
    57: "hossam",          # مندوب بيع حسام موسى
}


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        taken = {u.username: u.id for u in db.scalars(select(User))}
        rows: list[tuple[User, str, str]] = []
        clashes: list[str] = []

        for uid, new in RENAMES.items():
            u = db.get(User, uid)
            if u is None:
                clashes.append(f"مستخدم #{uid} مش موجود — الأرقام اتغيّرت؟")
                continue
            if u.username == new:
                continue
            owner = taken.get(new)
            if owner is not None and owner != uid:
                clashes.append(f"«{new}» متاخد لـ#{owner} — مش هيتغيّر #{uid}")
                continue
            rows.append((u, u.username, new))

        # اسمين جداد متطابقين في الخريطة نفسها — بيعدّوا الفحص فوق لأن ولا واحد
        # فيهم متسجّل لسه، وبيقعوا وقت الكتابة. الفحص هنا قبل ما نكتب حاجة.
        seen: dict[str, int] = {}
        for u, _old, new in rows:
            if new in seen:
                clashes.append(f"«{new}» مكرر في الخريطة: #{seen[new]} و#{u.id}")
            seen[new] = u.id

        print(f"{'الاسم القديم':<28}{'الجديد':<20}الموظف")
        print("-" * 74)
        for u, old, new in sorted(rows, key=lambda r: r[2]):
            print(f"{old:<28}{new:<20}{u.full_name or ''}")
        print(f"\nهيتغيّر: {len(rows)} اسم")

        if clashes:
            print("\n⚠️ مشاكل:")
            for c in clashes:
                print(f"   {c}")
            print("\n⛔ وقفت — صلّح الخريطة الأول.")
            return

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for u, _old, new in rows:
            u.username = new
        db.commit()
        print(f"\n✔ اتغيّر {len(rows)} اسم. كلمات السر زي ما هي.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
