"""يعمل عهدة نقدية لكل مندوب بيبيع — من غيرها الفاتورة من التطبيق بتترفض.

    python -m src.scripts.ensure_rep_custody
    python -m src.scripts.ensure_rep_custody --yes

`sales_service.create_sale` بينده `resolve_cash_account`، ودي للمندوب بترجّع حساب
عهدته. جدول العهدة كان **فاضي تماماً** — يعني ولا مندوب واحد كان يقدر يعمل فاتورة
من التطبيق، والرد كان 500 «خطأ في الخادم» فالسبب مايوصلش لحد.

**العهدة غير المخزن.** المخزن بيمسك بضاعته، والعهدة بتمسك **فلوسه**: الحساب اللي
بيتقيّد فيه اللي حصّله لحد ما يورّده. المندوب اللي بيبيع محتاج الاتنين.

بيتعمل للمناديب اللي **عندهم مخزن** بس: اللي مالوش مخزن مابيبيعش أصلاً، وعمل عهدة
له بيدّي انطباع إنه جاهز وهو لسه ناقصه المخزن.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.ledger import Account, AccountType, Direction
from src.models.employee import Employee
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Custody, HolderType


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        rep_role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        if rep_role is None:
            raise SystemExit("مافيش دور مندوب مبيعات")

        have = {c.rep_id for c in db.scalars(select(Custody)).all() if c.rep_id}
        with_store = {e.user_id for e in db.scalars(
            select(Employee).where(Employee.warehouse_id.is_not(None))).all() if e.user_id}

        reps = db.scalars(select(User).where(User.role_id == rep_role.id,
                                             User.active.is_(True))).all()
        need = [u for u in reps if u.id in with_store and u.id not in have]
        skip_no_store = [u for u in reps if u.id not in with_store and u.id not in have]

        print(f"{'مناديب نشطين':<28}{len(reps):>6}")
        print(f"{'  عندهم عهدة خلاص':<28}{len([u for u in reps if u.id in have]):>6}")
        print(f"{'  محتاجين عهدة':<28}{len(need):>6}")
        print(f"{'  مالهمش مخزن (هيتخطوا)':<28}{len(skip_no_store):>6}")
        if need:
            print("\nهتتعمل لـ:")
            for u in need:
                print(f"   {u.username:<28}{u.full_name or ''}")
        if skip_no_store:
            print("\nاتخطّوا — مالهمش مخزن فمابيبيعوش:")
            for u in skip_no_store[:15]:
                print(f"   {u.username:<28}{u.full_name or ''}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for u in need:
            # الحساب الأول، وبعدين العهدة، وبعدين `owner_ref` بيرجع يشاور عليها —
            # نفس ترتيب `POST /warehouses/custodies` بالظبط عشان الاتنين يطلّعوا
            # نفس الشكل، مش شكلين لنفس الحاجة.
            acc = Account(account_type=AccountType.custody, owner_ref=None,
                          normal_side=Direction.debit)
            db.add(acc)
            db.flush()
            cu = Custody(holder_type=HolderType.rep, rep_id=u.id,
                         warehouse_id=None, account_id=acc.id)
            db.add(cu)
            db.flush()
            acc.owner_ref = cu.id
        db.commit()
        print(f"\n✔ اتعملت {len(need)} عهدة.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
