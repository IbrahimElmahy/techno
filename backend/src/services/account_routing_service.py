from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.account_routing import AccountRouting
from src.models.ledger import Account, AccountNature, AccountType
from src.services import account_resolver, org_service
from src.services.financial_reports_service import effective_nature


class RoutingError(Exception):
    pass


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

EXPECTED_NATURE: dict[str, AccountNature] = {
    "treasury": AccountNature.asset,
    "sales_revenue": AccountNature.income,
    "purchases_expense": AccountNature.expense,
    "loyalty_expense": AccountNature.expense,
    "opening_balance_equity": AccountNature.equity,
}


def routed_account(db: Session, role: str, *, branch_id: int | None = None) -> Account | None:
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
    bid = org_service.resolve_branch_id(db, branch_id)
    out = []
    for role, fallback in ROUTABLE.items():
        acc = routed_account(db, role, branch_id=bid)
        source = "configured"
        if acc is None:
            acc = account_resolver.get_or_create_singleton(db, fallback, branch_id=bid)
            source = "default"
        expected = EXPECTED_NATURE.get(role)
        nature = effective_nature(acc)
        out.append({
            "role": role,
            "label": ROLE_LABEL.get(role, role),
            "account_id": acc.id,
            "account_code": acc.code,
            "account_name": acc.name,
            "source": source,
            "nature_warning": (
                None if expected is None or nature is None or nature == expected
                else f"طبيعة الحساب «{nature.value}» مختلفة عن المتوقّع «{expected.value}»."
            ),
        })
    return out
