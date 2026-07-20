"""Treasuries + period lock — 019-finance-treasuries.

Each treasury owns one ledger account, so its balance is derived, never stored. The legacy
singleton treasury account is adopted as the default safe on first use, which keeps every
existing document posting exactly where it used to.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import Account, AccountNature, AccountType, Direction
from src.models.treasury import PeriodLock, Treasury, TreasuryKind
from src.services import account_resolver, audit_service, ledger_service


class TreasuryError(Exception):
    pass


def default_treasury(db: Session) -> Treasury:
    """The safe used when a document names none — adopts the legacy singleton account."""
    existing = db.scalar(
        select(Treasury).where(Treasury.is_default.is_(True), Treasury.active.is_(True))
    )
    if existing is not None:
        return existing
    legacy_account = account_resolver.treasury_account(db)
    adopted = db.scalar(select(Treasury).where(Treasury.account_id == legacy_account.id))
    if adopted is None:
        adopted = Treasury(name="الخزينة الرئيسية", kind=TreasuryKind.cash,
                           account_id=legacy_account.id, is_default=True)
        db.add(adopted)
    else:
        adopted.is_default = True
    db.flush()
    return adopted


def create_treasury(
    db: Session, *, name: str, kind: TreasuryKind = TreasuryKind.cash,
    branch_id: int | None = None, bank_name: str | None = None,
    account_number: str | None = None, is_default: bool = False, actor_user_id: int,
) -> Treasury:
    if not name.strip():
        raise TreasuryError("اسم الخزينة مطلوب.")
    if db.scalar(select(Treasury).where(Treasury.name == name.strip())) is not None:
        raise TreasuryError("يوجد خزينة بنفس الاسم.")
    account = Account(
        account_type=AccountType.treasury, owner_ref=None, normal_side=Direction.debit,
        name=name.strip(), nature=AccountNature.asset, is_postable=True, is_system=False,
    )
    db.add(account)
    db.flush()
    if is_default:
        for other in db.scalars(select(Treasury).where(Treasury.is_default.is_(True))).all():
            other.is_default = False
    treasury = Treasury(
        name=name.strip(), kind=kind, branch_id=branch_id, account_id=account.id,
        bank_name=bank_name, account_number=account_number, is_default=is_default,
    )
    db.add(treasury)
    db.flush()
    account.owner_ref = treasury.id
    audit_service.record(db, action="treasury.create", actor_user_id=actor_user_id,
                         entity_type="treasury", entity_id=treasury.id,
                         after={"name": treasury.name, "kind": kind.value})
    return treasury


def get_treasury(db: Session, treasury_id: int) -> Treasury:
    treasury = db.get(Treasury, treasury_id)
    if treasury is None or not treasury.active:
        raise TreasuryError("الخزينة غير موجودة أو موقوفة.")
    return treasury


def resolve(db: Session, treasury_id: int | None) -> Treasury:
    return get_treasury(db, treasury_id) if treasury_id is not None else default_treasury(db)


def list_treasuries(db: Session, *, active_only: bool = False) -> list[Treasury]:
    stmt = select(Treasury)
    if active_only:
        stmt = stmt.where(Treasury.active.is_(True))
    return db.scalars(stmt.order_by(Treasury.is_default.desc(), Treasury.id)).all()


def balance(db: Session, treasury: Treasury) -> Decimal:
    return ledger_service.balance_of(db, treasury.account_id)


def update_treasury(
    db: Session, *, treasury_id: int, actor_user_id: int, name: str | None = None,
    bank_name: str | None = None, account_number: str | None = None,
    is_default: bool | None = None, active: bool | None = None,
) -> Treasury:
    treasury = db.get(Treasury, treasury_id)
    if treasury is None:
        raise TreasuryError("الخزينة غير موجودة.")
    if name:
        treasury.name = name.strip()
        account = db.get(Account, treasury.account_id)
        if account is not None:
            account.name = treasury.name
    if bank_name is not None:
        treasury.bank_name = bank_name
    if account_number is not None:
        treasury.account_number = account_number
    if is_default:
        for other in db.scalars(select(Treasury).where(Treasury.is_default.is_(True))).all():
            other.is_default = False
        treasury.is_default = True
    if active is False:
        if treasury.is_default:
            raise TreasuryError("لا يمكن إيقاف الخزينة الافتراضية.")
        if balance(db, treasury) != 0:
            raise TreasuryError("لا يمكن إيقاف خزينة برصيد — حوّل رصيدها أولاً.")
        treasury.active = False
    elif active is True:
        treasury.active = True
    db.flush()
    audit_service.record(db, action="treasury.update", actor_user_id=actor_user_id,
                         entity_type="treasury", entity_id=treasury.id,
                         after={"name": treasury.name, "active": treasury.active})
    return treasury


# --------------------------------------------------------------------------- period lock

def current_lock(db: Session) -> PeriodLock | None:
    return db.scalar(select(PeriodLock).order_by(PeriodLock.id.desc()).limit(1))


def locked_through(db: Session) -> date | None:
    lock = current_lock(db)
    return lock.locked_through if lock else None


def set_lock(db: Session, *, through: date, actor_user_id: int,
             note: str | None = None) -> PeriodLock:
    """Close the books through a date (or reopen by moving the date back)."""
    lock = PeriodLock(locked_through=through, note=note, actor_user_id=actor_user_id)
    db.add(lock)
    db.flush()
    audit_service.record(db, action="period.lock", actor_user_id=actor_user_id,
                         entity_type="period_lock", entity_id=lock.id,
                         after={"through": str(through), "note": note})
    return lock
