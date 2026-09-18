"""يجهّز مندوب اختبار كامل: يوزر + مخزن + عهدة + عميل + بضاعة.

    python -m src.scripts.create_test_rep              # عرض فقط
    python -m src.scripts.create_test_rep --yes
    python -m src.scripts.create_test_rep --yes --items 12

**التطبيق بيرفض المندوب الناقص، ومابيقولش ناقصه إيه.** `/sales/rep-bundle` بيرجع 404
«مالكش عهدة ولا مخزن مسجّل» لو المخزن مش متسجّل، و`create_sale` بيرجع 500 لو العهدة
مش موجودة. فالمندوب اللي اتعمل بنص طقم بيبان شغّال لحد ما يجرّب يبيع.

الطقم:

1. **مخزن اختبار** لوحده — مش مخزن حقيقي. البيع من مخزن الشركة بيخصم بضاعة فعلية،
   والتجربة اللي بتغيّر أرقام الجرد مش تجربة.
2. **يوزر** بدور مندوب، و**كارت موظف** مربوط بيه وبالمخزن — ده اللي `rep_store`
   بتقرا منه.
3. **عهدة** — دي فلوسه مش بضاعته، والاتنين لازمين.
4. **عميل اختبار** مربوط بيه. المندوب بيبيع لعملاءه هو بس، واللي مالوش عميل بيفتح
   الشاشة فيلاقيها فاضية.
5. **بضاعة** — بتيجي **تحويل** من المخزن الرئيسي مش افتتاحي. الافتتاحي بيخلق كمية
   من العدم فبيزوّد مخزون الشركة؛ التحويل بينقلها، فالإجمالي مايتغيّرش.

كله موسوم بـ«اختبار» في الاسم عشان يتعرف ويتشال. Idempotent: بيعيد استعمال اللي
موجود مش بيعمل نسخة تانية.
"""
from __future__ import annotations

import secrets
import string
import sys
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.catalog import Item
from src.models.customer import Customer, CustomerType
from src.models.employee import Employee
from src.models.org import Branch, Territory
from src.models.role import Role, RoleName
from src.models.stock import LocationKind, StockDirection, StockMovement
from src.models.transfer import TransferRoute
from src.models.user import User
from src.models.warehouse import Custody, HolderType, Warehouse, WarehouseType
from src.services import transfer_service

USERNAME = "test.rep"
FULL_NAME = "مندوب اختبار"
WAREHOUSE = "مخزن اختبار"
CUSTOMER = "عميل اختبار"
EMP_CODE = "TEST-REP"
CUST_CODE = "TEST-CUST"
QTY = Decimal("50")

_ALPHABET = string.ascii_letters + string.digits


def _password(length: int = 12) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def _on_hand(db, item_id: int, kind: LocationKind, loc: int) -> Decimal:
    rows = db.execute(
        select(StockMovement.direction, func.coalesce(func.sum(StockMovement.quantity), 0))
        .where(StockMovement.item_id == item_id,
               StockMovement.location_kind == kind,
               StockMovement.location_id == loc)
        .group_by(StockMovement.direction)
    ).all()
    total = Decimal("0")
    for direction, qty in rows:
        total += Decimal(str(qty)) * (1 if direction == StockDirection.in_ else -1)
    return total


def run(*, execute: bool, item_count: int) -> None:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.is_head_office.is_(True))) or \
            db.scalars(select(Branch)).first()
        role = db.scalar(select(Role).where(Role.name == RoleName.sales_rep))
        if role is None:
            print("✗ مافيش دور «مندوب مبيعات» — شغّل seed_branch_structure الأول.")
            return

        # المخزن اللي البضاعة هتتنقل منه: **اللي فيه أكتر أصناف**، مش اللي نوعه
        # «مركزي». الكتالوج كله اتنقل من a5 بنوع `branch` — مافيش ولا مخزن مركزي
        # واحد — فالاختيار بالنوع كان بيرجع فاضي ويقف السكربت على شرط شكلي.
        source_id = db.execute(
            select(StockMovement.location_id,
                   func.count(func.distinct(StockMovement.item_id)).label("n"))
            .where(StockMovement.location_kind == LocationKind.warehouse)
            .group_by(StockMovement.location_id)
            .order_by(func.count(func.distinct(StockMovement.item_id)).desc())
            .limit(1)
        ).first()
        source = db.get(Warehouse, source_id[0]) if source_id else None
        if source is None:
            print("✗ مافيش مخزن فيه بضاعة أنقل منه.")
            return

        wh = db.scalar(select(Warehouse).where(Warehouse.name == WAREHOUSE))
        user = db.scalar(select(User).where(User.username == USERNAME))
        emp = db.scalar(select(Employee).where(Employee.code == EMP_CODE))
        cust = db.scalar(select(Customer).where(Customer.code == CUST_CODE))

        print("=" * 56)
        print(f"{'الفرع':<28}{branch.name if branch else '—'}")
        print(f"{'المخزن المصدر':<28}{source.name}")
        print("-" * 56)
        print(f"{'مخزن الاختبار':<28}{'موجود' if wh else 'هيتعمل'}")
        print(f"{'اليوزر':<28}{'موجود' if user else 'هيتعمل'}  ({USERNAME})")
        print(f"{'كارت الموظف':<28}{'موجود' if emp else 'هيتعمل'}")
        print(f"{'العميل':<28}{'موجود' if cust else 'هيتعمل'}  ({CUSTOMER})")

        # الأصناف اللي فيها رصيد في المخزن المصدر — دي اللي ينفع تتنقل.
        rows = db.execute(
            select(StockMovement.item_id)
            .where(StockMovement.location_kind == LocationKind.warehouse,
                   StockMovement.location_id == source.id)
            .group_by(StockMovement.item_id)
        ).all()
        candidates: list[int] = []
        for (item_id,) in rows:
            if _on_hand(db, item_id, LocationKind.warehouse, source.id) >= QTY:
                candidates.append(item_id)
            if len(candidates) >= item_count:
                break
        items = {i.id: i for i in db.scalars(
            select(Item).where(Item.id.in_(candidates or [-1]))).all()}
        print(f"{'أصناف هتتنقل':<28}{len(candidates)} × {QTY}")
        for item_id in candidates[:8]:
            print(f"     {items[item_id].code:<18}{items[item_id].name[:34]}")

        if not execute:
            print("\n[عرض فقط] مافيش حاجة اتعملت. ضيف --yes للتنفيذ.")
            return

        if wh is None:
            wh = Warehouse(name=WAREHOUSE, warehouse_type=WarehouseType.branch,
                           branch_id=branch.id if branch else None,
                           description="مخزن تجربة التطبيق — مش مخزن حقيقي.", active=True)
            db.add(wh)
            db.flush()

        password = None
        if user is None:
            password = _password()
            user = User(username=USERNAME, password_hash=hash_password(password),
                        role_id=role.id, branch_id=branch.id if branch else None,
                        full_name=FULL_NAME, active=True)
            db.add(user)
            db.flush()
        else:
            user.role_id = role.id
            user.active = True

        if emp is None:
            emp = Employee(code=EMP_CODE, name=FULL_NAME, user_id=user.id,
                           warehouse_id=wh.id, branch_id=branch.id if branch else None)
            db.add(emp)
        else:
            emp.user_id = user.id
            emp.warehouse_id = wh.id
        db.flush()

        # العهدة بتمسك فلوسه. `uq_custody_warehouse` بيمنع اتنين على نفس المخزن.
        custody = db.scalar(select(Custody).where(Custody.rep_id == user.id,
                                                  Custody.family.is_(None)))
        if custody is None:
            custody = Custody(holder_type=HolderType.rep, rep_id=user.id,
                              warehouse_id=None, family=None, active=True)
            db.add(custody)
            db.flush()

        if cust is None:
            # «تاجر» عشان يكسب نقط زي أي تاجر حقيقي — التجربة على نوع العميل اللي
            # التطبيق اتعمل عشانه، مش على نوع تاني بقواعد تانية.
            territory = db.scalars(select(Territory).order_by(Territory.id)).first()
            cust = Customer(code=CUST_CODE, name=CUSTOMER, rep_id=user.id,
                            customer_type=CustomerType.trader.value,
                            territory_id=territory.id if territory else None,
                            branch_id=branch.id if branch else None, active=True)
            db.add(cust)
        else:
            cust.rep_id = user.id
            cust.active = True
        db.flush()

        # **البضاعة بتتنقل بإذن تحويل حقيقي، مش بحركات مكتوبة بالإيد.**
        #
        # الحركة اللي `source_doc_id` بتاعها صفر حركة يتيمة: مالهاش مستند يتفتح، ولا
        # تتلغي، ولا تظهر في أي كشف بيسأل «البضاعة دي جت منين». والإذن بيعمل نفس
        # الحركتين وبيسيب وراه مستند مرقّم ينفع يتراجع ويتلغي — ولإن التجربة دي
        # هدفها نثق في النظام، ماينفعش نجهّزها بحاجة النظام نفسه بيعتبرها غلط.
        moved = 0
        needed = [i for i in candidates
                  if _on_hand(db, i, LocationKind.warehouse, wh.id) < QTY]
        if needed:
            transfer = transfer_service.initiate(
                db, item_id=needed[0], quantity=QTY,
                route=TransferRoute.central_to_branch,
                source_kind=LocationKind.warehouse, source_id=source.id,
                dest_kind=LocationKind.warehouse, dest_id=wh.id,
                initiated_by=user.id)
            for item_id in needed[1:]:
                transfer_service.add_line(db, transfer_id=transfer.id,
                                          item_id=item_id, quantity=QTY)
            db.flush()
            transfer_service.approve(
                db, transfer_id=transfer.id, approver_role=RoleName.system_admin,
                approver_branch_id=None, approver_user_id=user.id, is_admin=True)
            moved = len(needed)
        db.commit()

        print("\n" + "=" * 56)
        print("✔ المندوب جاهز")
        print("=" * 56)
        print(f"   اسم المستخدم : {USERNAME}")
        if password:
            print(f"   الباسورد     : {password}")
            print("   ⚠ بتتعرض مرة واحدة بس.")
        else:
            print("   الباسورد     : زي ما هي — اليوزر كان موجود")
        print(f"   المخزن       : {wh.name} (#{wh.id})")
        print(f"   العميل       : {cust.name} (#{cust.id})")
        print(f"   أصناف اتنقلت : {moved} × {QTY}"
          + (f"  (إذن {transfer.document_number})" if moved else ""))
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    count = int(args[args.index("--items") + 1]) if "--items" in args else 10
    run(execute="--yes" in args, item_count=count)
