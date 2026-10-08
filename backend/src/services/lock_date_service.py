from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.accounting_setting import AccountingSetting
from src.models.role import Role, RoleName
from src.models.user import User


class LockDateError(Exception):
    pass


ADVISER_ROLES = frozenset({RoleName.system_admin.value, RoleName.accountant.value})


def get_settings(db: Session) -> AccountingSetting:
    row = db.scalar(select(AccountingSetting).order_by(AccountingSetting.id).limit(1))
    if row is None:
        row = AccountingSetting()
        db.add(row)
        db.flush()
    return row


def _peek(db: Session) -> tuple[date | None, date | None]:
    row = db.scalar(select(AccountingSetting).order_by(AccountingSetting.id).limit(1))
    if row is None:
        return None, None
    return row.fiscalyear_lock_date, row.period_lock_date


def _is_adviser(db: Session, user_id: int | None) -> bool:
    if user_id is None:
        return True
    name = db.scalar(
        select(Role.name).join(User, User.role_id == Role.id).where(User.id == user_id)
    )
    if name is None:
        return False
    return getattr(name, "value", name) in ADVISER_ROLES


def assert_open(db: Session, when: date | None, *, actor_user_id: int | None = None) -> None:
    fiscal, period = _peek(db)
    if fiscal is None and period is None:
        return
    day = when or date.today()
    if fiscal is not None and day <= fiscal:
        raise LockDateError(
            f"السنة مقفولة حتى {fiscal:%Y-%m-%d} — مافيش حركة بتاريخ {day:%Y-%m-%d}. "
            "الأدمن هو اللي بيحرّك تاريخ القفل من إعدادات المحاسبة."
        )
    if period is not None and day <= period and not _is_adviser(db, actor_user_id):
        raise LockDateError(
            f"الفترة مقفولة حتى {period:%Y-%m-%d} — مافيش حركة بتاريخ {day:%Y-%m-%d}. "
            "المحاسب أو الأدمن يقدر يعدّل في الفترة دي."
        )


def set_lock_dates(
    db: Session,
    *,
    actor_user_id: int,
    fiscalyear_lock_date: date | None = None,
    period_lock_date: date | None = None,
    note: str | None = None,
) -> AccountingSetting:
    row = get_settings(db)
    row.fiscalyear_lock_date = fiscalyear_lock_date
    row.period_lock_date = period_lock_date
    row.updated_by_user_id = actor_user_id
    db.flush()

    if period_lock_date is not None:
        from src.models.treasury import PeriodLock

        db.add(PeriodLock(locked_through=period_lock_date, note=note,
                          actor_user_id=actor_user_id))
        db.flush()

    from src.services import audit_service

    audit_service.record(
        db, action="accounting.lock_dates", actor_user_id=actor_user_id,
        entity_type="accounting_setting", entity_id=row.id,
        after={"fiscalyear": str(fiscalyear_lock_date or ""),
               "period": str(period_lock_date or ""), "note": note},
    )
    return row
