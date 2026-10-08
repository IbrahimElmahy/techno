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

from src.scripts.fix_account_natures import target_for_group as _target_nature


OPENING_DOC = "a5_opening"

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
                tgt = _target_nature(int(a5id), prefix, name)
                nature, side = tgt if tgt else (AccountNature.asset, Direction.debit)
                acc = Account(
                    account_type=AccountType.user_defined, name=name, code=code,
                    nature=nature, normal_side=side,
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

        all_items = db.scalars(select(Item)).all()
        mine = [i for i in all_items if not prefix or (i.code or "").startswith(prefix)]
        item_by_code = {i.code: i for i in mine if i.code}
        item_by_name = {i.name: i for i in mine}
        from src.services.a5_item_map import A5ItemMap
        a5map = A5ItemMap(db, prefix, mine)
        wh_by_name = ({w.name: w for w in db.scalars(
            select(Warehouse).where(Warehouse.branch_id == branch.id)).all()}
            if branch else {})

        done = {(m.item_id, m.location_id) for m in db.scalars(
            select(stock_service.StockMovement).where(
                stock_service.StockMovement.source_doc_type == OPENING_DOC)).all()}
        if done:
            print(f"أرصدة افتتاحية موجودة: {len(done)} صنف×مخزن — هتتخطى.")
        for r in opens:
            if len(r) < 7:
                continue
            code, name = _clean(r[0]), _clean(r[1])
            it = a5map.find(code, name)
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
            out = qty < 0
            stock_service.post_movement(
                db, item_id=it.id, location_kind=LocationKind.warehouse,
                location_id=wh.id, movement_type="opening",
                direction=StockDirection.out if out else StockDirection.in_,
                quantity=abs(qty), allow_negative=True,
                source_doc_type=OPENING_DOC, source_doc_id=0,
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
