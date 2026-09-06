"""يصلّح كشف الموظفين: الكود بيرجع لكود a5، والدلاء بتخرج من الكشف.

    python -m src.scripts.fix_a5_employee_codes --dir C:/pgtmp          # يعرض بس
    python -m src.scripts.fix_a5_employee_codes --dir C:/pgtmp --yes    # ينفّذ

بيتعاد تشغيله بأمان: اللي كوده مظبوط واللي معطّل خلاص بيتخطّوا.

---------------------------------------------------------------------------
جرد الموظفين مقابل `Emp` في a5 طلّع ١٢ صف كودهم `EMP-xxxx` مش `A5E-{Emp_id}`.
اتفحصوا واحد واحد وطلعوا تلات أنواع:

* **واحد بس راجل حقيقي:** «عمرو رجب» (`EMP-0001`) — مندوب بيع الجيزة، `Emp_id=4`
  في أكتوبر، وعليه **٢٠٬٧٢٩ ج** ذمة في `A5S-55`. كوده بيرجع `A5E-4` عشان يقع في
  نفس نظام الترقيم بتاع باقي الـ٩٥، وعشان إعادة الاستيراد تلاقيه فمتعملوش نسخة تانية.

* **تمنية دلاء محاسبية:** «مندوبية الفيوم/الحرفيين/الجيزة ١/الجيزة٢/المنيا/المنصورة»
  و«ادارة المبيعات» و«rep». دي **مش ناس** — a5 عامل ليها حسابات عشان الترحيل يلاقي
  مكان يقعد فيه، و`import_a5_emp.BUCKET` بيرفضها صح. بس دول اتسرّبوا لكشف الموظفين
  من مسار تاني (مش المستورد)، فبيظهروا في المرتبات والحضور كأنهم موظفين.

  **بيتعطّلوا مش بيتمسحوا.** اتقاس: صفر مرجع عليهم في كل جداول القاعدة — فالمسح
  كان هيعدّي. بس التعطيل بيشيلهم من الكشوف ويفضل يرجّعهم بضغطة لو طلع إن واحد
  فيهم بيتحاسب فعلاً. والمسح مالوش رجعة.

  وأرصدتهم مش بتضيع: الفلوس قاعدة على حساباتها في الدفتر (`عهدة سيارة الفيوم`
  ٢٬٥١٠ مثلاً)، والحساب حاجة تانية غير كارت الموظف.

* **تلاتة بتوعنا:** «مندوب المبيعات — أكتوبر/العلياء/السادات». دول مش من a5 أصلاً،
  بيتسابوا زي ما هم.
"""
from __future__ import annotations

import csv
import os
import sys

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text

from src.core.db import SessionLocal, engine
from src.models.employee import Employee

# الكود القديم → (كود a5 الجديد، الفرع في a5). المصدر: `a5_emp.tsv` أكتوبر صف رقم ٤.
RECODE: dict[str, tuple[str, str]] = {
    "EMP-0001": ("A5E-4", "أكتوبر"),
}

# دلاء محاسبية تسرّبت لكشف الموظفين — بتتعطّل.
BUCKETS = (
    "EMP-0096",  # «rep» — نص إنجليزي مالوش معنى
    "EMP-0097",  # مندوبية الفيوم
    "EMP-0098",  # مندوبية الحرفيين
    "EMP-0099",  # مندوبية الجيزة 1
    "EMP-0100",  # مندوبية الجيزة2
    "EMP-0101",  # ادارة المبيعات
    "EMP-0102",  # مندوبية المنيا
    "EMP-0103",  # مندوبية المنصورة
)


def _emp_rows(folder: str) -> dict[str, str]:
    """`a5_emp.tsv` → {الاسم: Emp_id}. الفاصل `~` زي باقي التصدير."""
    path = os.path.join(folder, "a5_emp.tsv")
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — شغّل a5_sync.ps1 -ExportOnly الأول.")
    out: dict[str, str] = {}
    with open(path, encoding="utf-8", newline="") as fh:
        for r in csv.reader(fh, delimiter="~"):
            if r and r[0] == "EMP" and len(r) > 2:
                out.setdefault((r[2] or "").strip(), r[1])
    return out


def _refs(db, emp_id: int) -> list[str]:
    """كل جدول بيشاور على الموظف ده — التعطيل بيتاخد وعينه مفتوحة."""
    insp = sa_inspect(engine)
    hits: list[str] = []
    for t in insp.get_table_names():
        for fk in insp.get_foreign_keys(t):
            if fk.get("referred_table") != "employee":
                continue
            col = fk["constrained_columns"][0]
            n = db.execute(text(f'SELECT count(*) FROM "{t}" WHERE {col} = :i'),
                           {"i": emp_id}).scalar()
            if n:
                hits.append(f"{t}.{col}={n}")
    return hits


def run(folder: str, *, execute: bool) -> None:
    by_name = _emp_rows(folder)
    db = SessionLocal()
    try:
        taken = {c for (c,) in db.execute(select(Employee.code)).all()}
        recode: list[tuple[Employee, str]] = []
        off: list[tuple[Employee, list[str]]] = []
        notes: list[str] = []

        for old, (new, _br) in RECODE.items():
            e = db.scalar(select(Employee).where(Employee.code == old))
            if e is None:
                notes.append(f"{old}: مش موجود — اتخطّى")
                continue
            # الاسم لازم يطابق a5، والكود الجديد لازم يكون فاضي.
            a5id = by_name.get((e.name or "").strip())
            if a5id is None:
                notes.append(f"{old} «{e.name}»: مش في كشف a5 — اتخطّى")
                continue
            want = f"A5E-{a5id}"
            if want != new:
                notes.append(f"{old} «{e.name}»: a5 بيقول {want} والسكربت بيقول {new} — اتخطّى")
                continue
            if want in taken:
                notes.append(f"{old} «{e.name}»: {want} محجوز لحد تاني — اتخطّى")
                continue
            recode.append((e, want))

        for code in BUCKETS:
            e = db.scalar(select(Employee).where(Employee.code == code))
            if e is None:
                notes.append(f"{code}: مش موجود — اتخطّى")
                continue
            if not e.active:
                notes.append(f"{code} «{e.name}»: معطّل خلاص")
                continue
            off.append((e, _refs(db, e.id)))

        print(f"{'كود هيترجّع لكود a5':<34}{len(recode):>6}")
        for e, want in recode:
            print(f"   {e.code} → {want:<10} «{e.name}»")
        print(f"\n{'دلو هيتعطّل':<34}{len(off):>6}")
        for e, hits in off:
            print(f"   {e.code:<10} «{(e.name or '')[:26]:<26}» مراجع: {hits or 'مفيش'}")
        blocked = [e.code for e, hits in off if hits]
        if blocked:
            print(f"\n⚠ فيه مراجع على {blocked} — هيتساب زي ما هو.")
        if notes:
            print("\nملاحظات:")
            for n in notes:
                print("   •", n)
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for e, want in recode:
            e.code = want
        n_off = 0
        for e, hits in off:
            if hits:
                continue  # اللي عليه مرجع مايتلمسش — ده قرار محتاج عين
            e.active = False
            n_off += 1
        db.commit()

        left = db.scalars(select(Employee).where(Employee.code.like("EMP-%"),
                                                 Employee.active.is_(True))).all()
        print(f"\n✔ اترجّع {len(recode)} كود · اتعطّل {n_off} دلو")
        print(f"   لسه بكود EMP- ونشط: {len(left)}")
        for e in left:
            print(f"      {e.code:<10} {e.name}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
