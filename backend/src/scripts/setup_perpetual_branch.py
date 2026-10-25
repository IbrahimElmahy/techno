from __future__ import annotations

import argparse
from datetime import date

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.income_statement_setting import IncomeStatementSetting
from src.models.ledger import Account, AccountNature, AccountType, Direction
from src.models.org import Branch
from src.models.perpetual import InventoryAccount
from src.models.warehouse import Warehouse, WarehouseType
from src.services import audit_service

WIP_WAREHOUSE = "تحت التشغيل"

ACCOUNTS = {
    "raw": ("RAW", "مخزون الخامات", "المخزون", AccountNature.asset, Direction.debit),
    "wip": ("WIP", "تحت التشغيل", "المخزون", AccountNature.asset, Direction.debit),
    "finished": ("FIN", "مخزون الإنتاج التام", "المخزون", AccountNature.asset, Direction.debit),
    "cogs": ("COGS", "تكلفة البضاعة المباعة", "تكلفة المبيعات", AccountNature.expense,
             Direction.debit),
    "adjust": ("ADJ", "فروق جرد المخزون", "فروق مخزون", AccountNature.expense, Direction.debit),
    "opening": ("OPN", "حساب وسيط — مخزون بداية الجرد المستمر", "ارباح وخسائر مرحلة",
                AccountNature.equity, Direction.credit),
}
NOT_IN_STATEMENT = ("cogs", "adjust", "opening")

ROLES = {
    "raw": ("مخزن الخامات", "مخزن ادوات التعبئة", "مخزن حقن البولى", "مخزن سحب المواسير",
            "مخزن حقن قطع الصرف", "المشغل بيور", "المشغل عمرو محمود", "المشغل محمد جمال",
            "مخزن الجيوان", "مخزن قطع عمرو محمود"),
    "finished": ("مخزن الانتاج التام السادات", "@@ المخزن الرئيسى", "مخزن الجودة", "مخزن ا مدحت",
                 "محزن ا علي الابحر", "مخزن مرتجعات الموردين", "مخزن المرتجعات الهالكة",
                 "مخزن الجودة لعينات قطع الجيوان"),
    "wip": (WIP_WAREHOUSE,),
}


def _prefix(db, branch_id: int) -> str:
    code = db.scalar(select(Account.code).where(Account.branch_id == branch_id,
                                                Account.code.like("%-A5M-%")).limit(1)) or ""
    return code.split("A5M-")[0] if "A5M-" in code else ""


def run(*, branch_name: str, start: date, execute: bool) -> None:
    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == branch_name))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{branch_name}»")
        prefix = _prefix(db, branch.id)
        made: dict[str, int] = {}
        for role, (suffix, name, parent_name, nature, side) in ACCOUNTS.items():
            code = f"{prefix}INV-{suffix}"
            acc = db.scalar(select(Account).where(Account.code == code))
            parent = db.scalar(select(Account).where(Account.branch_id == branch.id,
                                                     Account.name == parent_name,
                                                     Account.is_postable.is_(False)))
            if parent is None:
                raise SystemExit(f"مافيش مجموعة «{parent_name}» في دليل حسابات {branch.name}")
            print(f"{role:<9} {code:<16} {name:<34} تحت «{parent.name}»",
                  "موجود" if acc else "جديد")
            if acc is None and execute:
                acc = Account(account_type=AccountType.user_defined, code=code, name=name,
                              nature=nature, normal_side=side, is_postable=True,
                              is_system=True, parent_id=parent.id, branch_id=branch.id)
                db.add(acc)
                db.flush()
            if acc is not None:
                made[role] = acc.id

        wip = db.scalar(select(Warehouse).where(Warehouse.branch_id == branch.id,
                                                Warehouse.name == WIP_WAREHOUSE))
        print(f"مخزن «{WIP_WAREHOUSE}»:", "موجود" if wip else "جديد")
        if wip is None and execute:
            wip = Warehouse(name=WIP_WAREHOUSE, warehouse_type=WarehouseType.branch,
                            branch_id=branch.id, active=True)
            db.add(wip)
            db.flush()

        wanted = {n: role for role, names in ROLES.items() for n in names}
        houses = db.scalars(select(Warehouse).where(Warehouse.branch_id == branch.id)).all()
        missing = []
        for w in houses:
            role = wanted.get(w.name)
            if role is None:
                missing.append(w.name)
                continue
            if w.inventory_role != role:
                print(f"   {w.name:<36} {w.inventory_role or '—'} ← {role}")
                if execute:
                    w.inventory_role = role
        if missing:
            print("مخازن من غير تصنيف (حسابها هيبقى فروق الجرد):", "، ".join(missing))

        print(f"بداية الجرد المستمر: {branch.perpetual_from or '—'} ← {start}")
        if not execute:
            print("عرض فقط — أضف --yes للتنفيذ")
            return
        for role, account_id in made.items():
            row = db.scalar(select(InventoryAccount).where(
                InventoryAccount.branch_id == branch.id, InventoryAccount.role == role))
            if row is None:
                db.add(InventoryAccount(branch_id=branch.id, role=role, account_id=account_id))
            else:
                row.account_id = account_id
        company = db.scalar(select(IncomeStatementSetting).where(
            IncomeStatementSetting.branch_id.is_(None)))
        if company is not None:
            cfg = dict(company.config or {})
            accounts_cfg = dict(cfg.get("accounts") or {})
            roles_cfg = dict(accounts_cfg.get("roles") or {})
            for role in NOT_IN_STATEMENT:
                if role in made:
                    roles_cfg[str(made[role])] = "excluded"
            accounts_cfg["roles"] = roles_cfg
            cfg["accounts"] = accounts_cfg
            company.config = cfg
        before = branch.perpetual_from
        branch.perpetual_from = start
        audit_service.record(db, action="perpetual.setup", actor_user_id=None,
                             entity_type="branch", entity_id=branch.id,
                             before={"perpetual_from": str(before) if before else None},
                             after={"perpetual_from": str(start), "accounts": made,
                                    "wip_warehouse": wip.id if wip else None})
        db.commit()
        print("✔ تم")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="تجهيز الجرد المستمر لفرع: حسابات ومخزن تحت التشغيل وتصنيف المخازن")
    ap.add_argument("--branch", required=True)
    ap.add_argument("--from", dest="start", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    run(branch_name=a.branch, start=date.fromisoformat(a.start), execute=a.yes)


if __name__ == "__main__":
    main()
