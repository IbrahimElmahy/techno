"""يربط كل «سيارة» بالراجل اللي بيسوقها — الموظف الحقيقي وراء حساب المندوب.

    python -m src.scripts.link_car_reps          # يعرض بس
    python -m src.scripts.link_car_reps --yes    # ينفّذ

بيتعاد تشغيله بأمان: الربط الموجود صح مابيتلمسش.

---------------------------------------------------------------------------
**المشكلة:** a5 بيسمّي المندوب باسم عربيته مش باسمه — «مندوب السياره ( ب )»،
و`Cust.ph1` على ١٬٣٠٨ عميل مكتوب فيه الاسم ده. فحساب الدخول عندنا اسمه العربية،
وde صح ومايتغيّرش (هو المفتاح اللي العملاء اتربطوا بيه).

لكن **مين الراجل؟** `import_a5_emp` ربط كل حساب مندوب بموظف اسمه نفس اسم العربية
(a5 مسجّل العربيات نفسها في جدول `Emp`) — يعني الربط بيقول «مندوب السياره ( ب ) هو
مندوب السياره ( ب )»، وده مايقولش حاجة.

**الأسماء الحقيقية من المستخدم، وa5 بيأكدها:** الخمسة كلهم في كشف «ذمم الموظفين»
عند a5 ووظيفتهم مكتوبة «مندوب تسويق» — حذيفه (حساب ٣٠٨، ٨ فواتير)، ابراهيم حسونه
(٤٠٠)، محمد مكرم (٩٥٠، ٥ فواتير)، احمد صبرى (١٩٨، ١٣ فاتورة)، حسام موسي (٢١٦٦).

**اللي بيحصل:** الموظف البديل بيتفك من حساب المندوب، والحقيقي بياخد مكانه ومعاه
**المخزن** — `rep_store_service.rep_store` بيقرا `employee.warehouse_id`، فلو المخزن
مااتنقلش المندوب مايقدرش يبيع.

**حذيفه مالوش صف في `Emp`** عند a5 — موجود في شجرة الحسابات وكشف الموظفين بس. فبيتعمل
له صف موظف من كارته (`AL-A5E-308`)، بنفس كود الكارت عشان الاتنين يفضلوا مربوطين.

**الاسم المكرر بيتحسم بالفرع:** «احمد صبرى» موجود في الفرعين، و«حسام موسي» ليه صفين
(واحد «فون كاش»). الاختيار هنا بكود الحساب من a5 مش بالاسم — الكود رقم مايتكررش.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.employee import Employee
from src.models.user import User
from src.models.warehouse import Warehouse

# username المندوب → (اسم الراجل، كود كارته/حسابه عند a5)
#
# الكود هو الفيصل مش الاسم: `AL-A5E-<AccBrnch_id>` رقم الحساب في «ذمم الموظفين»،
# وهو اللي بيفرّق «احمد صبرى» بتاع العلياء عن اللي في أكتوبر.
PAIRS: dict[str, tuple[str, str]] = {
    "car.a":       ("حذيفه زين عبد الفتاح", "AL-A5E-308"),
    "car.b":       ("ابراهيم حسونه", "AL-A5E-400"),
    "car.g":       ("محمد مكرم", "AL-A5E-950"),
    "car.d":       ("احمد صبرى", "AL-A5E-198"),
    "car.sharqia": ("حسام موسي", "AL-A5E-2166"),
}


def _find_employee(db, name: str, code: str, branch_id: int | None) -> Employee | None:
    """الموظف بالكود، وإلا بالاسم جوّه الفرع — واللي بيطلّع أكتر من واحد بيرجع None."""
    emp = db.scalar(select(Employee).where(Employee.code == code))
    if emp is not None:
        return emp
    stmt = select(Employee).where(Employee.name == name)
    if branch_id is not None:
        stmt = stmt.where(Employee.branch_id == branch_id)
    rows = db.scalars(stmt).all()
    return rows[0] if len(rows) == 1 else None


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        plan: list[tuple[User, Employee | None, Employee | None, str, str]] = []
        problems: list[str] = []

        for username, (person, code) in PAIRS.items():
            user = db.scalar(select(User).where(User.username == username))
            if user is None:
                problems.append(f"{username}: مافيش يوزر بالاسم ده")
                continue
            old = db.scalar(select(Employee).where(Employee.user_id == user.id))
            new = _find_employee(db, person, code, user.branch_id)
            if new is None:
                # كارت الموظف موجود في كشف العملاء بس مالوش صف موظف — بيتعمل.
                card = db.scalar(select(Customer).where(Customer.code == code))
                if card is None:
                    problems.append(f"{username}: مالقيتش «{person}» لا موظف ولا كارت ({code})")
                    continue
                plan.append((user, old, None, person, code))
                continue
            if new.user_id is not None and new.user_id != user.id:
                other = db.get(User, new.user_id)
                who = other.username if other else new.user_id
                problems.append(f"{username}: «{person}» مربوط خلاص بـ{who}")
                continue
            plan.append((user, old, new, person, code))

        print(f"{'المندوب':<14}{'دلوقتي':<26}{'هيبقى':<26}المخزن")
        print("-" * 84)
        for user, old, new, person, _code in plan:
            wh = db.get(Warehouse, old.warehouse_id) if old and old.warehouse_id else None
            tag = "(هيتعمل)" if new is None else f"#{new.id}"
            print(f"{user.username:<14}{str(old.name if old else '—')[:24]:<26}"
                  f"{(person + ' ' + tag)[:24]:<26}{wh.name if wh else '—'}")
        if problems:
            print("\n⚠️ محتاج مراجعة:")
            for p in problems:
                print("   ", p)
        if not plan:
            print("\nمافيش حاجة تتعمل.")
            return
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        made = 0
        for user, old, new, person, code in plan:
            wh_id = old.warehouse_id if old else None
            if old is not None and (new is None or old.id != new.id):
                # الاسم بيفضل، بس مابقاش مربوط بحساب دخول ولا ماسك مخزن.
                old.user_id = None
                old.warehouse_id = None
                db.flush()
            if new is None:
                new = Employee(code=code, name=person, branch_id=user.branch_id, active=True)
                db.add(new)
                db.flush()
                made += 1
            new.user_id = user.id
            if wh_id is not None:
                new.warehouse_id = wh_id
        db.commit()

        print(f"\n✔ اتربط {len(plan)} مندوب" + (f" · اتعمل {made} كارت موظف جديد" if made else ""))
        print("\nالتحقق:")
        bad = 0
        for username, (person, _code) in PAIRS.items():
            user = db.scalar(select(User).where(User.username == username))
            emp = db.scalar(select(Employee).where(Employee.user_id == user.id)) if user else None
            wh = db.get(Warehouse, emp.warehouse_id) if emp and emp.warehouse_id else None
            ok = emp is not None and emp.name == person and wh is not None
            bad += not ok
            nm = str(emp.name if emp else "—")[:24]
            print(f"{'✔' if ok else '✘'} {username:<14} → «{nm:<24}»"
                  f" مخزن: {wh.name if wh else '—'}")
        if bad:
            sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
