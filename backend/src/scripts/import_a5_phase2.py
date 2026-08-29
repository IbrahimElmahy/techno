"""المرحلة التانية من استيراد a5: شجرة الحسابات، وربط المناديب بمخازنهم، والأرصدة الافتتاحية.

المرحلة الأولى (`import_a5`) جابت الكيانات — أصناف وعملاء ومناطق ومخازن. دي بتجيب اللي
بينهم: الحسابات اللي الفلوس بتتقيّد عليها، والمخزن بتاع كل مندوب، والبضاعة اللي كانت
موجودة أول المدة.

    python -m src.scripts.import_a5_phase2 --dir C:/pgtmp          # يعرض بس
    python -m src.scripts.import_a5_phase2 --dir C:/pgtmp --yes    # ينفّذ

    # شركة تانية على فرع تاني:
    python -m src.scripts.import_a5_phase2 --dir C:/aliaa --branch العلياء --prefix AL- --yes

بيتعاد تشغيله بأمان.

---------------------------------------------------------------------------
تلات ترجمات:

* **الشجرة مستويين عندهم، شجرة حقيقية عندنا.** `acc_Main` (٥٩ رئيسي) و`accBrnch` (١٢٩٤
  فرعي) — جدولين منفصلين والابن شايل رقم أبيه. عندنا جدول واحد بـ`parent_id`، والرئيسي
  بيبقى «مجموعة» (`is_postable=False`) لأن الترحيل على مجموعة بيخلّي مجموع الأبناء مش
  مساوي أبوهم.

* **المندوب ومخزنه مربوطين بالاسم جوّه الاسم.** «مخزن عمرو رجب» — اسم المندوب جوّه اسم
  المخزن، و`Store_Mang` مليان في واحد من ١١. فبنطابق على الاتنين.

* **الرصيد الافتتاحي حركة مخزون مش رقم مخزّن.** الرصيد عندنا مشتق من الحركات، فالافتتاحي
  بيدخل حركة دخول بمستند `opening` — وبكده كارت الصنف بيبدأ من سطر مفهوم بدل رقم نازل من
  السما.
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.employee import Employee
from src.models.ledger import Account, AccountNature, AccountType, Direction
from src.models.org import Branch
from src.models.role import Role, RoleName
from src.models.stock import LocationKind, StockDirection
from src.models.user import User
from src.models.warehouse import Warehouse
from src.scripts.import_a5 import JUNK, _clean, _money, _read
from src.services import stock_service

# `Type_Nature` في a5 → طبيعة الحساب عندنا. الترقيم من بياناتهم.
NATURE = {
    "1": (AccountNature.asset, Direction.debit),
    "2": (AccountNature.liability, Direction.credit),
    "3": (AccountNature.equity, Direction.credit),
    "4": (AccountNature.income, Direction.credit),
    "5": (AccountNature.expense, Direction.debit),
}


def run(folder: str, *, execute: bool, branch_name: str = "",
        prefix: str = "") -> None:
    accs = _read(os.path.join(folder, "a5_acc.tsv"))
    opens = _read(os.path.join(folder, "a5_open.tsv"))
    mains = [r for r in accs if r and r[0] == "MAIN"]
    subs = [r for r in accs if r and r[0] == "SUB"]

    print("المصدر:")
    print(f"   حسابات رئيسية        {len(mains):>6}")
    print(f"   حسابات فرعية         {len(subs):>6}")
    print(f"   أرصدة افتتاحية       {len(opens):>6}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    made = {"مجموعات": 0, "حسابات": 0, "ربط مناديب": 0, "أرصدة": 0}
    skipped: list[str] = []
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit("مافيش فرع اسمه " + branch_name)
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        admin = db.scalars(select(User).order_by(User.id)).first()
        print("الفرع المستهدف: " + (branch.name if branch else "—")
              + ((" · البادئة: " + prefix) if prefix else "") + "\n")

        # ---------- ١) شجرة الحسابات ----------
        by_code = {a.code: a for a in db.scalars(select(Account)).all() if a.code}
        main_by_a5: dict[str, Account] = {}

        for r in mains:
            a5id, name = r[1], _clean(r[2])
            if not name or JUNK.match(name):
                skipped.append(f"حساب رئيسي باسم غير صالح: «{name}»")
                continue
            code = f"{prefix}A5M-{a5id}"
            acc = by_code.get(code)
            if acc is None:
                nature, side = NATURE.get(r[3], (AccountNature.asset, Direction.debit))
                acc = Account(
                    account_type=AccountType.user_defined, name=name, code=code,
                    nature=nature, normal_side=side,
                    # الرئيسي مجموعة: الترحيل عليه بيخلّي مجموع الأبناء مش مساوي أبوهم.
                    is_postable=False, is_system=False,
                    branch_id=branch.id if branch else None, active=True)
                db.add(acc)
                db.flush()
                by_code[code] = acc
                made["مجموعات"] += 1
            main_by_a5[a5id] = acc

        for r in subs:
            a5id, name, parent_a5 = r[1], _clean(r[2]), r[3]
            if not name or JUNK.match(name):
                skipped.append(f"حساب فرعي باسم غير صالح: «{name}»")
                continue
            code = f"{prefix}A5S-{a5id}"
            if code in by_code:
                continue
            parent = main_by_a5.get(parent_a5)
            nature = parent.nature if parent else AccountNature.asset
            side = parent.normal_side if parent else Direction.debit
            db.add(Account(
                account_type=AccountType.user_defined, name=name, code=code,
                nature=nature, normal_side=side,
                parent_id=parent.id if parent else None,
                is_postable=True, is_system=False,
                branch_id=branch.id if branch else None, active=True))
            made["حسابات"] += 1
        db.flush()

        # ---------- ٢) المندوب ومخزنه ----------
        #
        # الربط بالاسم جوّه الاسم: «مخزن عمرو رجب». مش أنضف طريقة، بس دي اللي في الداتا —
        # والبديل إن كل مندوب يتربط بإيده من الشاشة.
        rep_role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        reps = (db.scalars(select(User).where(User.role_id == rep_role.id,
                                              User.branch_id == branch.id)).all()
                if rep_role and branch else [])
        whs = (db.scalars(select(Warehouse).where(Warehouse.active.is_(True),
                                                  Warehouse.branch_id == branch.id)).all()
               if branch else [])
        taken = {e.warehouse_id for e in db.scalars(select(Employee)).all() if e.warehouse_id}

        for u in reps:
            emp = db.scalars(select(Employee).where(Employee.user_id == u.id)).first()
            if emp is not None and emp.warehouse_id:
                continue
            full = _clean(u.full_name or "")
            if not full:
                continue
            match = next((w for w in whs
                          if w.id not in taken and full and full in w.name), None)
            if match is None:
                continue
            if emp is None:
                n = db.scalar(select(func.count()).select_from(Employee)) or 0
                code = f"EMP-{n + 1:04d}"
                while db.scalars(select(Employee).where(Employee.code == code)).first():
                    n += 1
                    code = f"EMP-{n + 1:04d}"
                emp = Employee(code=code, name=full, user_id=u.id,
                               branch_id=u.branch_id, active=True)
                db.add(emp)
                db.flush()
            emp.warehouse_id = match.id
            taken.add(match.id)
            made["ربط مناديب"] += 1
            print(f"   {u.username} ← {match.name}")
        db.flush()

        # ---------- ٣) الأرصدة الافتتاحية ----------
        # الكتالوج بيتقسّم بالبادئة: كود a5 عدّاد جوّه كل شركة، فنفس الكود بيبقى صنفين.
        all_items = db.scalars(select(Item)).all()
        mine = [i for i in all_items if not prefix or (i.code or "").startswith(prefix)]
        item_by_code = {i.code: i for i in mine if i.code}
        item_by_name = {i.name: i for i in mine}
        wh_by_name = ({w.name: w for w in db.scalars(
            select(Warehouse).where(Warehouse.branch_id == branch.id)).all()}
            if branch else {})

        # اتعملت قبل كده؟ الحارس بيشتغل لكل صنف×مخزن لوحده مش للتشغيلة كلها.
        #
        # كان بيتخطى كل حاجة لو لقى أي حركة افتتاحية، ومعنى كده إن أي سطر ماكانش دخل
        # في المرة الأولى مايدخلش أبداً — والسطور السالبة كانت بره فعلاً، فالرصيد كان
        # ناقص ٣٦ وحدة في أكتوبر. الحارس المفصّل بيمنع التكرار وبيسمح باللي فات.
        done = {(m.item_id, m.location_id) for m in db.scalars(
            select(stock_service.StockMovement).where(
                stock_service.StockMovement.source_doc_type
                == f"a5_opening{prefix}")).all()}
        if done:
            print(f"أرصدة افتتاحية موجودة: {len(done)} صنف×مخزن — هتتخطى.")
        for r in opens:
            if len(r) < 7:
                continue
            code, name = _clean(r[0]), _clean(r[1])
            it = item_by_code.get(f"{prefix}{code}") or item_by_name.get(name)
            if it is None:
                skipped.append(f"رصيد لصنف مش موجود: «{name}» ({code})")
                continue
            store = _clean(r[2]) or _clean(r[3])
            wh = wh_by_name.get(store)
            if wh is None:
                skipped.append(f"رصيد في مخزن مش موجود: «{store}»")
                continue
            if (it.id, wh.id) in done:
                continue
            qty = _money(r[4]) or _money(r[5]) or _money(r[6])
            if qty == 0:
                continue
            # a5 عنده أرصدة أول مدة بالسالب — مخزن بدأ بعجز. بتتسجّل حركة خروج مش
            # بتتخطى: تخطّيها بيدي رصيد أعلى من الحقيقي.
            out = qty < 0
            stock_service.post_movement(
                db, item_id=it.id, location_kind=LocationKind.warehouse,
                location_id=wh.id, movement_type="opening",
                direction=StockDirection.out if out else StockDirection.in_,
                quantity=abs(qty), allow_negative=True,
                source_doc_type=f"a5_opening{prefix}", source_doc_id=0,
                actor_user_id=admin.id if admin else 1)
            done.add((it.id, wh.id))
            made["أرصدة"] += 1
        db.flush()

        db.commit()
        print(f"\n{'الكيان':<16}{'اتعمل':>8}")
        print("-" * 26)
        for k, v in made.items():
            print(f"{k:<16}{v:>8}")
        if skipped:
            print(f"\nاتخطّى {len(skipped)}:")
            for s in skipped[:12]:
                print("   ", s)
            if len(skipped) > 12:
                print(f"    … و{len(skipped) - 12} غيرهم")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    run(folder, execute="--yes" in args, branch_name=branch, prefix=prefix)
