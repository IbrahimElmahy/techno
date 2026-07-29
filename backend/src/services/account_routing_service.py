"""Reading and writing التوجيه المحاسبي.

The rules that matter here are the ones that stop a routing change from quietly corrupting the
books:

* the target must be **postable** — pointing a role at a group account would produce entries the
  trial balance cannot roll up;
* the target must be a **real, active** account;
* clearing a role is allowed and means «back to the default», which is the escape hatch when
  somebody points a role somewhere wrong and needs the safe behaviour back immediately.

What is deliberately *not* enforced: that the account's nature matches the role's normal side. An
accountant may well have a good reason to route «خصم مسموح به» somewhere this system would not
predict, and refusing them would be this system claiming to know their chart better than they do.
The nature mismatch is reported to them as a warning instead.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.account_routing import AccountRouting
from src.models.ledger import Account, AccountNature, AccountType
from src.services import account_resolver, org_service


class RoutingError(Exception):
    """A routing that would break posting — a missing, inactive or non-postable target."""


# The roles an admin may point somewhere, mapped to the seeded account type each falls back to.
# Only roles this system actually posts to are listed: offering a role nothing posts to would be a
# setting that appears to do something and does not.
# Deliberately absent: customer_receivable and supplier_payable. Those are **per party** here —
# each customer owns their own receivable account, which is what makes «كشف حساب العميل» and the
# aging report possible at all. Pointing the role at one account would merge every customer's
# balance into a single lump, and no per-customer statement could ever be produced again. Their
# system offers «العملاء» because it keeps one control account and a subsidiary ledger beside it;
# ours puts the detail in the chart, and that is not a setting to be toggled.
ROUTABLE: dict[str, AccountType] = {
    "treasury": AccountType.treasury,
    "sales_revenue": AccountType.sales_revenue,
    "purchases_expense": AccountType.purchases_expense,
    "loyalty_expense": AccountType.loyalty_expense,
    "opening_balance_equity": AccountType.opening_balance_equity,
}

ROLE_LABEL: dict[str, str] = {
    "treasury": "الخزينة",
    "sales_revenue": "المبيعات",
    "purchases_expense": "المشتريات",
    "loyalty_expense": "مصروف نقاط الولاء",
    "opening_balance_equity": "أرصدة افتتاحية",
}

# The nature each role is normally posted to. Used only to warn, never to refuse.
EXPECTED_NATURE: dict[str, AccountNature] = {
    "treasury": AccountNature.asset,
    "sales_revenue": AccountNature.income,
    "purchases_expense": AccountNature.expense,
    "loyalty_expense": AccountNature.expense,
    "opening_balance_equity": AccountNature.equity,
}


def routed_account(db: Session, role: str, *, branch_id: int | None = None) -> Account | None:
    """The account this role is pointed at, or None to mean «use the default».

    An override pointing at an account that has since been deactivated is ignored rather than
    honoured: posting to a disabled account is the kind of failure that surfaces weeks later in a
    statement nobody can explain, and the seeded default is always safe.
    """
    if role not in ROUTABLE:
        return None
    bid = org_service.resolve_branch_id(db, branch_id)
    row = db.scalar(
        select(AccountRouting).where(
            AccountRouting.role == role, AccountRouting.branch_id == bid
        )
    )
    if row is None:
        return None
    acc = db.get(Account, row.account_id)
    if acc is None or not acc.active or not acc.is_postable:
        return None
    return acc


def set_routing(
    db: Session, role: str, *, account_id: int | None, branch_id: int | None = None
) -> Account | None:
    """Point a role at an account, or pass None to restore the default.

    Returns the account now in effect for the role, so the caller can show what the change did
    rather than assume it took.
    """
    if role not in ROUTABLE:
        raise RoutingError(f"«{role}» ليس دوراً محاسبياً معروفاً.")
    bid = org_service.resolve_branch_id(db, branch_id)
    existing = db.scalar(
        select(AccountRouting).where(
            AccountRouting.role == role, AccountRouting.branch_id == bid
        )
    )

    if account_id is None:
        if existing is not None:
            db.delete(existing)
            db.flush()
        return account_resolver.get_or_create_singleton(db, ROUTABLE[role], branch_id=bid)

    acc = db.get(Account, account_id)
    if acc is None:
        raise RoutingError("الحساب غير موجود.")
    if not acc.active:
        raise RoutingError(f"حساب «{acc.name}» معطّل — التوجيه ليه معناه ترحيل لحساب مقفول.")
    if not acc.is_postable:
        raise RoutingError(
            f"«{acc.name}» مجموعة مش حساب ترحيل. التوجيه لازم يكون لحساب ورقة."
        )

    if existing is None:
        db.add(AccountRouting(role=role, account_id=acc.id, branch_id=bid))
    else:
        existing.account_id = acc.id
    db.flush()
    return acc


def current_routing(db: Session, *, branch_id: int | None = None) -> list[dict]:
    """Every routable role with the account in effect and where that account came from.

    «default» vs «configured» is shown because the two look identical once posted, and an admin
    debugging a wrong statement needs to know whether somebody changed this or nobody ever did.
    """
    bid = org_service.resolve_branch_id(db, branch_id)
    out = []
    for role, fallback in ROUTABLE.items():
        acc = routed_account(db, role, branch_id=bid)
        source = "configured"
        if acc is None:
            acc = account_resolver.get_or_create_singleton(db, fallback, branch_id=bid)
            source = "default"
        expected = EXPECTED_NATURE.get(role)
        out.append({
            "role": role,
            "label": ROLE_LABEL.get(role, role),
            "account_id": acc.id,
            "account_code": acc.code,
            "account_name": acc.name,
            "source": source,
            # A mismatch is worth saying out loud without blocking: the accountant may mean it.
            "nature_warning": (
                None if expected is None or acc.nature == expected
                else f"طبيعة الحساب «{acc.nature.value}» مختلفة عن المتوقّع «{expected.value}»."
            ),
        })
    return out
