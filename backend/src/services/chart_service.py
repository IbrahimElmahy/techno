from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, AccountNature, AccountType, LedgerEntry, LedgerLine
from src.services import ledger_service
from src.services.account_resolver import (
    NATURE_NORMAL_SIDE,
    get_or_create_singleton,
)


class ChartError(Exception):
    pass


_GROUPS: list[tuple[str, str, AccountNature, str | None]] = [
    ("1", "الأصول", AccountNature.asset, None),
    ("1.01", "الأصول المتداولة", AccountNature.asset, "1"),
    ("1.02", "الذمم المدينة", AccountNature.asset, "1"),
    ("2", "الالتزامات", AccountNature.liability, None),
    ("2.01", "الذمم الدائنة", AccountNature.liability, "2"),
    ("3", "حقوق الملكية", AccountNature.equity, None),
    ("4", "الإيرادات", AccountNature.income, None),
    ("5", "التكلفة والمصروفات", AccountNature.expense, None),
]

_GROUP_CODE_BY_TYPE: dict[AccountType, str] = {
    AccountType.treasury: "1.01",
    AccountType.custody: "1.01",
    AccountType.customer_receivable: "1.02",
    AccountType.supplier_payable: "2.01",
    AccountType.sales_revenue: "4",
    AccountType.purchases_expense: "5",
    AccountType.loyalty_expense: "5",
    AccountType.opening_balance_equity: "3",
}

_NATURE_BY_TYPE: dict[AccountType, AccountNature] = {
    AccountType.treasury: AccountNature.asset,
    AccountType.custody: AccountNature.asset,
    AccountType.customer_receivable: AccountNature.asset,
    AccountType.supplier_payable: AccountNature.liability,
    AccountType.sales_revenue: AccountNature.income,
    AccountType.purchases_expense: AccountNature.expense,
    AccountType.loyalty_expense: AccountNature.expense,
    AccountType.opening_balance_equity: AccountNature.equity,
}

_SINGLETON_LEAVES: list[tuple[AccountType, str, str]] = [
    (AccountType.treasury, "1.01.001", "الخزينة"),
    (AccountType.opening_balance_equity, "3.001", "أرصدة افتتاحية"),
    (AccountType.sales_revenue, "4.001", "إيرادات المبيعات"),
    (AccountType.purchases_expense, "5.001", "المشتريات"),
    (AccountType.loyalty_expense, "5.002", "مصروف نقاط الولاء"),
]


def seed_standard_chart(db: Session) -> dict[str, Account]:
    groups: dict[str, Account] = {}
    for code, name, nature, parent_code in _GROUPS:
        node = db.scalar(select(Account).where(Account.code == code))
        if node is None:
            node = Account(
                account_type=AccountType.user_defined,
                normal_side=NATURE_NORMAL_SIDE[nature],
                code=code,
                name=name,
                nature=nature,
                is_postable=False,
                is_system=True,
                parent_id=(groups[parent_code].id if parent_code else None),
            )
            db.add(node)
            db.flush()
        groups[code] = node

    for account_type, code, name in _SINGLETON_LEAVES:
        acc = get_or_create_singleton(db, account_type)
        acc.code = code
        acc.name = name
        acc.nature = _NATURE_BY_TYPE[account_type]
        acc.is_postable = True
        acc.is_system = True
        acc.parent_id = groups[_GROUP_CODE_BY_TYPE[account_type]].id
        db.flush()

    backfill_types = (
        AccountType.custody,
        AccountType.customer_receivable,
        AccountType.supplier_payable,
    )
    for acc in db.scalars(select(Account).where(Account.account_type.in_(backfill_types))).all():
        acc.nature = _NATURE_BY_TYPE[acc.account_type]
        acc.is_postable = True
        acc.is_system = True
        if acc.parent_id is None:
            acc.parent_id = groups[_GROUP_CODE_BY_TYPE[acc.account_type]].id
        db.flush()

    return groups


def effective_parent_id(db: Session, account: Account) -> int | None:
    if account.parent_id is not None:
        return account.parent_id
    group_code = _GROUP_CODE_BY_TYPE.get(account.account_type)
    if group_code is None:
        return None
    grp = db.scalar(select(Account).where(Account.code == group_code))
    return grp.id if grp else None


def create_account(
    db: Session,
    *,
    code: str,
    name: str,
    nature: AccountNature,
    is_postable: bool,
    parent_id: int | None,
    appears_in: str | None = None,
    main_level: str | None = None,
) -> Account:
    code = code.strip()
    if not code:
        raise ChartError("كود الحساب مطلوب.")
    if db.scalar(select(Account).where(Account.code == code)) is not None:
        raise ChartError(f"كود الحساب «{code}» مسجّل مسبقاً.")

    parent: Account | None = None
    if parent_id is not None:
        parent = db.get(Account, parent_id)
        if parent is None:
            raise ChartError("الحساب الرئيسي غير موجود.")
        if parent.is_postable:
            raise ChartError("يجب أن يكون الحساب الرئيسي مجموعة لا حساباً يقبل الترحيل.")
        if not code.startswith(parent.code + "."):
            raise ChartError(
                f"يجب أن يبدأ كود الحساب الفرعي «{code}» بكود الرئيسي «{parent.code}»."
            )
    elif "." in code:
        raise ChartError("لا يجوز أن يحتوي كود الحساب الرئيسي الأعلى على نقطة.")

    acc = Account(
        account_type=AccountType.user_defined,
        normal_side=NATURE_NORMAL_SIDE[nature],
        code=code,
        name=name,
        nature=nature,
        is_postable=is_postable,
        is_system=False,
        parent_id=parent_id,
    )
    if appears_in:
        if appears_in not in _APPEARS_IN:
            raise ChartError(
                "يجب أن تكون قيمة «يظهر في»: متاجرة (trading) أو أرباح وخسائر (profit_loss) "
                "أو ميزانية عمومية (balance_sheet)."
            )
        acc.appears_in = appears_in
    if main_level:
        acc.main_level = main_level
    db.add(acc)
    db.flush()
    return acc


_APPEARS_IN = {"trading", "profit_loss", "balance_sheet", "none"}


def update_account(
    db: Session, *, account_id: int, name: str | None = None, active: bool | None = None,
    appears_in: str | None = None, main_level: str | None = None,
    reconcilable: bool | None = None,
) -> Account:
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("الحساب غير موجود.")
    if name is not None:
        acc.name = name
    if appears_in is not None:
        if appears_in and appears_in not in _APPEARS_IN:
            raise ChartError(
                "يجب أن تكون قيمة «يظهر في»: متاجرة (trading) أو أرباح وخسائر (profit_loss) "
                "أو ميزانية عمومية (balance_sheet)."
            )
        acc.appears_in = appears_in or None
    if main_level is not None:
        acc.main_level = main_level or None
    if reconcilable is not None:
        acc.reconcilable = reconcilable
    if active is not None:
        if active is False:
            _assert_deactivatable(db, acc)
        acc.active = active
    db.flush()
    return acc


def deactivate_account(db: Session, *, account_id: int) -> Account:
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("الحساب غير موجود.")
    _assert_deactivatable(db, acc)
    acc.active = False
    db.flush()
    return acc


def _assert_deactivatable(db: Session, acc: Account) -> None:
    if acc.is_system:
        raise ChartError("لا يمكن إقفال حسابات النظام.")
    has_active_child = db.scalar(
        select(Account.id).where(Account.parent_id == acc.id, Account.active.is_(True))
    )
    if has_active_child is not None:
        raise ChartError("تحت هذا الحساب حسابات نشطة — أقفلها أولاً.")


def account_balance(db: Session, account_id: int) -> Decimal:
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("الحساب غير موجود.")
    if acc.is_postable:
        return ledger_service.balance_of(db, account_id)
    total = ZERO
    for child in db.scalars(select(Account).where(Account.parent_id == account_id)).all():
        total += account_balance(db, child.id)
    return to_money(total)


def bulk_balances(db: Session) -> dict[int, Decimal]:
    rows = db.execute(
        select(LedgerLine.account_id, LedgerLine.direction, func.sum(LedgerLine.amount))
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(ledger_service.is_posted_sql())
        .group_by(LedgerLine.account_id, LedgerLine.direction)).all()
    accounts = db.execute(
        select(Account.id, Account.parent_id, Account.is_postable, Account.normal_side)).all()
    side = {a_id: normal for a_id, _p, _post, normal in accounts}

    out: dict[int, Decimal] = {}
    for account_id, direction, total in rows:
        signed = to_money(total or ZERO)
        if direction != side.get(account_id):
            signed = -signed
        out[account_id] = out.get(account_id, ZERO) + signed

    parent = {a_id: pid for a_id, pid, _post, _n in accounts}
    depth: dict[int, int] = {}

    def _depth(a_id: int) -> int:
        seen = set()
        d, cur = 0, a_id
        while parent.get(cur) is not None and cur not in seen:
            seen.add(cur)
            cur = parent[cur]
            d += 1
        return d

    for a_id, _pid, _post, _n in accounts:
        depth[a_id] = _depth(a_id)
    for a_id in sorted(depth, key=lambda x: -depth[x]):
        pid = parent.get(a_id)
        if pid is not None:
            out[pid] = out.get(pid, ZERO) + out.get(a_id, ZERO)
    return {k: to_money(v) for k, v in out.items()}


def is_postable_leaf(db: Session, account_id: int) -> bool:
    acc = db.get(Account, account_id)
    return bool(acc and acc.is_postable and acc.active)


_OWNER_LABEL: dict[AccountType, str] = {
    AccountType.customer_receivable: "العملاء",
    AccountType.supplier_payable: "الموردين",
    AccountType.treasury: "الخزينة والبنوك",
    AccountType.custody: "العهد",
}


def bulk_owner_names(db: Session, accounts: list[Account]) -> dict[int, str]:
    from src.models.customer import Customer, CustomerAccount
    from src.models.supplier import Supplier, SupplierAccount
    from src.models.treasury import Treasury
    from src.models.user import User
    from src.models.warehouse import Custody, HolderType, Warehouse

    wanted = [a.id for a in accounts if not a.name and a.account_type in _OWNER_LABEL]
    if not wanted:
        return {}

    out: dict[int, str] = {}

    def _link(link_model, owner_model, link_fk, prefix: str) -> None:
        for account_id, name in db.execute(
            select(link_model.account_id, owner_model.name)
            .join(owner_model, link_fk == owner_model.id)
            .where(link_model.account_id.in_(wanted))
        ).all():
            if name:
                out[account_id] = f"{prefix} — {name}"

    _link(CustomerAccount, Customer, CustomerAccount.customer_id, "عميل")
    for account_id, family in db.execute(
        select(CustomerAccount.account_id, CustomerAccount.family)
        .where(CustomerAccount.account_id.in_(wanted), CustomerAccount.family.isnot(None))
    ).all():
        if account_id in out and family:
            out[account_id] = f"{out[account_id]} — {family}"
    _link(SupplierAccount, Supplier, SupplierAccount.supplier_id, "مورد")

    for account_id, name in db.execute(
        select(Treasury.account_id, Treasury.name).where(Treasury.account_id.in_(wanted))
    ).all():
        if name:
            out[account_id] = f"خزينة — {name}"

    custodies = list(db.scalars(
        select(Custody).where(Custody.account_id.in_(wanted))
    ).all())
    if custodies:
        rep_names = dict(db.execute(
            select(User.id, User.full_name)
            .where(User.id.in_([c.rep_id for c in custodies if c.rep_id]))
        ).all())
        wh_names = dict(db.execute(
            select(Warehouse.id, Warehouse.name)
            .where(Warehouse.id.in_([c.warehouse_id for c in custodies if c.warehouse_id]))
        ).all())
        for c in custodies:
            who = (rep_names.get(c.rep_id) if c.holder_type == HolderType.rep
                   else wh_names.get(c.warehouse_id))
            if who and c.account_id:
                out[c.account_id] = f"عهدة — {who}"

    return out


def owner_group_label(account_type: AccountType) -> str | None:
    return _OWNER_LABEL.get(account_type)


def party_group(db: Session, branch_id: int | None, kind: str) -> Account | None:
    suffix = "A5M-5" if kind == "customer" else "A5M-6"
    name = "العملاء" if kind == "customer" else "الموردون"
    rows = db.scalars(select(Account).where(Account.branch_id == branch_id,
                                            Account.code.like(f"%{suffix}"))).all()
    hit = next((a for a in rows if a.code and a.code.endswith(suffix)), None)
    if hit is not None:
        return hit
    return db.scalars(select(Account).where(Account.branch_id == branch_id,
                                            Account.name == name,
                                            Account.is_postable.is_(False))).first()


def place_party_account(db: Session, account: Account, *, kind: str, name: str | None,
                        code: str | None, family: str | None = None) -> None:
    group = party_group(db, account.branch_id, kind)
    if group is not None and account.parent_id is None:
        account.parent_id = group.id
        account.nature = group.nature
    if not account.name and name:
        account.name = (f"{name} {family}" if family else name)[:160]
    if not account.code and code:
        want = (f"{code}-{family}" if family else code)[:40]
        taken = db.scalar(select(Account.id).where(Account.code == want))
        if taken is None:
            account.code = want
