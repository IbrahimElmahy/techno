"""Chart of Accounts service (005, T010/T012).

The chart is the Foundation `account` table viewed as a hierarchy (research R1). This module:
- seeds the standard group headings and re-homes the system accounts under them (T029 reuses this);
- creates/updates/deactivates user-defined accounts with the segmented-code + postable-leaf rules;
- derives an account's balance (leaf = Σ lines; group = subtree roll-up) — never stored (Princ. VI).

No new ledger. Postable leaves accept journal lines; group nodes only aggregate.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, AccountNature, AccountType, LedgerLine
from src.services import ledger_service
from src.services.account_resolver import (
    NATURE_NORMAL_SIDE,
    get_or_create_singleton,
)


class ChartError(Exception):
    """Invalid chart operation (bad code/parent, non-group parent, delete-with-history, ...)."""


# --- Standard chart definition (research R2) -------------------------------------------------

# Group headings: (code, Arabic name, nature, parent_code)
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

# Which group each system account_type lives under, and its nature.
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

# Singleton system leaves to seed with explicit codes/names: (account_type, code, name).
_SINGLETON_LEAVES: list[tuple[AccountType, str, str]] = [
    (AccountType.treasury, "1.01.001", "الخزينة"),
    (AccountType.opening_balance_equity, "3.001", "أرصدة افتتاحية"),
    (AccountType.sales_revenue, "4.001", "إيرادات المبيعات"),
    (AccountType.purchases_expense, "5.001", "المشتريات"),
    (AccountType.loyalty_expense, "5.002", "مصروف نقاط الولاء"),
]


def seed_standard_chart(db: Session) -> dict[str, Account]:
    """Idempotently create group headings, re-home system accounts, seed singleton leaves.

    Shared by the 0004 migration and the test `chart` fixture. Returns groups keyed by code.
    """
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

    # Singleton system leaves: get-or-create the account, then set its chart columns.
    for account_type, code, name in _SINGLETON_LEAVES:
        acc = get_or_create_singleton(db, account_type)
        acc.code = code
        acc.name = name
        acc.nature = _NATURE_BY_TYPE[account_type]
        acc.is_postable = True
        acc.is_system = True
        acc.parent_id = groups[_GROUP_CODE_BY_TYPE[account_type]].id
        db.flush()

    # Backfill per-owner system accounts (custody / customer_receivable / supplier_payable):
    # classify and re-home under their group; codes stay NULL (labelled by owner at read time).
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
    """The account's group: its explicit parent_id, else derived from account_type (per-owner
    accounts created after the seed). Used by the tree builder and trial-balance roll-up."""
    if account.parent_id is not None:
        return account.parent_id
    group_code = _GROUP_CODE_BY_TYPE.get(account.account_type)
    if group_code is None:
        return None
    grp = db.scalar(select(Account).where(Account.code == group_code))
    return grp.id if grp else None


# --- User-defined account CRUD ---------------------------------------------------------------

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
    """Create a chart node. Enforces: unique code, child code prefixed by parent code, and that
    the parent (if any) is a group node (FR-001/002/003/017)."""
    code = code.strip()
    if not code:
        raise ChartError("كود الحساب مطلوب.")
    if db.scalar(select(Account).where(Account.code == code)) is not None:
        raise ChartError(f"كود الحساب «{code}» متسجّل قبل كده.")

    parent: Account | None = None
    if parent_id is not None:
        parent = db.get(Account, parent_id)
        if parent is None:
            raise ChartError("الحساب الرئيسي مش موجود.")
        if parent.is_postable:
            raise ChartError("الحساب الرئيسي لازم يكون مجموعة مش حساب بيقبل الترحيل.")
        if not code.startswith(parent.code + "."):
            raise ChartError(
                f"كود الحساب الفرعي «{code}» لازم يبدأ بكود الرئيسي «{parent.code}»."
            )
    elif "." in code:
        raise ChartError("كود الحساب الرئيسي الأعلى مايكونش فيه نقطة.")

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
                "«يظهر في» لازم تكون: متاجرة (trading) أو أرباح وخسائر (profit_loss) "
                "أو ميزانية عمومية (balance_sheet)."
            )
        acc.appears_in = appears_in
    if main_level:
        acc.main_level = main_level
    db.add(acc)
    db.flush()
    return acc


# «يظهر في» — the three faces an account can be presented on. Egyptian practice splits the
# income statement in two: المتاجرة carries sales and cost of sales down to gross profit, and
# أرباح وخسائر carries indirect expenses and other income down to net profit. Collapsing them
# into one "income statement" loses the gross-profit line, which is the number a trader reads
# first — so the split is kept.
_APPEARS_IN = {"trading", "profit_loss", "balance_sheet", "none"}


def update_account(
    db: Session, *, account_id: int, name: str | None = None, active: bool | None = None,
    appears_in: str | None = None, main_level: str | None = None,
) -> Account:
    """Rename, (de)activate, and/or set «يظهر في». System accounts may be renamed but not
    deactivated if they still have active children (FR-005)."""
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("الحساب مش موجود.")
    if name is not None:
        acc.name = name
    if appears_in is not None:
        # Empty string means "follow the account's nature", which is the shipped behaviour.
        if appears_in and appears_in not in _APPEARS_IN:
            raise ChartError(
                "«يظهر في» لازم تكون: متاجرة (trading) أو أرباح وخسائر (profit_loss) "
                "أو ميزانية عمومية (balance_sheet)."
            )
        acc.appears_in = appears_in or None
    if main_level is not None:
        # Free text on purpose: every accountant has their own set of standard groupings
        # («أصول متداولة»، «مصروفات غير مباشرة»)، and an enum we invented would be wrong for the
        # first client whose chart is arranged differently.
        acc.main_level = main_level or None
    if active is not None:
        if active is False:
            _assert_deactivatable(db, acc)
        acc.active = active
    db.flush()
    return acc


def deactivate_account(db: Session, *, account_id: int) -> Account:
    """Soft-delete: never hard-delete an account with children or posted lines (FR-005/IV)."""
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("الحساب مش موجود.")
    _assert_deactivatable(db, acc)
    acc.active = False
    db.flush()
    return acc


def _assert_deactivatable(db: Session, acc: Account) -> None:
    if acc.is_system:
        raise ChartError("حسابات النظام مايتقفلوش.")
    has_active_child = db.scalar(
        select(Account.id).where(Account.parent_id == acc.id, Account.active.is_(True))
    )
    if has_active_child is not None:
        raise ChartError("الحساب ده تحته حسابات شغالة — اقفلهم الأول.")


def account_balance(db: Session, account_id: int) -> Decimal:
    """Derived balance: a leaf = signed Σ of its lines; a group = Σ of its descendant leaves."""
    acc = db.get(Account, account_id)
    if acc is None:
        raise ChartError("الحساب مش موجود.")
    if acc.is_postable:
        return ledger_service.balance_of(db, account_id)
    total = ZERO
    for child in db.scalars(select(Account).where(Account.parent_id == account_id)).all():
        total += account_balance(db, child.id)
    return to_money(total)


def bulk_balances(db: Session) -> dict[int, Decimal]:
    """رصيد كل حساب في الشجرة — استعلامين، مش استعلام لكل حساب.

    `account_balance` بتقرا سطور الحساب واحد واحد وبتتنده مرة لكل صف في الشاشة. شجرة
    فيها حساب لكل عميل بقت ٣٧٦٧ حساب و٤٨ ألف سطر، فشاشة الحسابات كانت بتاخد ١٠.٧ ثانية
    على السيرفر نفسه — من غير الشبكة. الجمع هنا بيحصل في القاعدة مرة واحدة.

    المجموعة = مجموع اللي تحتها، محسوبة من الورق لفوق عشان الشجرة تتمشي مرة واحدة.
    """
    rows = db.execute(
        select(LedgerLine.account_id, LedgerLine.direction, func.sum(LedgerLine.amount))
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

    # المجموعات: بنجمع من الابن لأبوه لحد الجذر. الترتيب بالعمق عشان الابن يخلص الأول.
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


# --------------------------------------------------------------- owner-derived names


# The account types whose rows are created FOR something else — a customer, a supplier, a safe, a
# rep's custody — rather than typed into the chart by hand. They carry `owner_ref` and no name.
_OWNER_LABEL: dict[AccountType, str] = {
    AccountType.customer_receivable: "العملاء",
    AccountType.supplier_payable: "الموردين",
    AccountType.treasury: "الخزينة والبنوك",
    AccountType.custody: "العهد",
}


def bulk_owner_names(db: Session, accounts: list[Account]) -> dict[int, str]:
    """Names for the accounts that were opened on behalf of somebody — ONE query per kind.

    A customer's receivable account IS his line in the chart, and until now it had no name in it:
    the الحسابات الفرعيه screen showed a column of «-» against real balances, which is a list you
    cannot read and therefore cannot check.

    Resolved by walking the LINK TABLES back to the account (`supplier_account.account_id`), not
    forward through `Account.owner_ref`. Both directions exist, but only one is reliable:
    `owner_ref` is set by the API when it creates the pair and is missing on every row a seeding
    or import script wrote, so two of three suppliers in the dev database came back nameless
    while the third worked. The link row is what actually holds the relationship; `owner_ref` is
    a convenience that was never backfilled.

    Derived, never stored. Renaming a customer has to rename his account too, and a copy taken at
    creation would drift the first time somebody fixed a spelling.
    """
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
    """«العملاء», «الموردين» … — the group an owner-derived account belongs under.

    Their chart files every customer under one «العملاء» heading. Ours reaches the same reading
    without a real parent row for each kind, so the screen can show where a nameless account
    belongs even when its `parent_id` points at the standard chart instead.
    """
    return _OWNER_LABEL.get(account_type)
