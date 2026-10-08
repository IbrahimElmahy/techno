from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.ledger import Account
from src.models.treasury import Treasury, TreasuryKind
from src.models.user import User
from src.models.warehouse import Custody, HolderType
from src.services import ledger_service


class CashBoxError(Exception):
    pass


@dataclass
class Box:
    key: str
    kind: str
    name: str
    account_id: int
    treasury_id: int | None
    custody_id: int | None
    branch_id: int | None
    rep_id: int | None
    rep_name: str | None
    family: str | None
    active: bool


def _treasury_box(t: Treasury) -> Box:
    return Box(key=f"t-{t.id}", kind="bank" if t.kind == TreasuryKind.bank else "cash",
               name=t.name, account_id=t.account_id, treasury_id=t.id, custody_id=None,
               branch_id=t.branch_id, rep_id=None, rep_name=None, family=None, active=t.active)


def _safe_box(c: Custody, acc: Account | None, rep: User | None) -> Box:
    rep_name = (getattr(rep, "full_name", None) or getattr(rep, "username", None)) if rep else None
    return Box(key=f"c-{c.id}", kind="safe",
               name=(acc.name if acc and acc.name else f"صندوق {rep_name or ''}").strip(),
               account_id=c.account_id, treasury_id=None, custody_id=c.id,
               branch_id=rep.branch_id if rep else None, rep_id=c.rep_id, rep_name=rep_name,
               family=c.family, active=c.active)


def boxes(db: Session, *, branch_id: int | None = None, active_only: bool = False) -> list[Box]:
    out: list[Box] = []
    for t in db.scalars(select(Treasury).order_by(Treasury.is_default.desc(), Treasury.id)).all():
        if branch_id is not None and t.branch_id not in (branch_id, None):
            continue
        out.append(_treasury_box(t))
    for c, acc, rep in db.execute(
        select(Custody, Account, User)
        .outerjoin(Account, Account.id == Custody.account_id)
        .outerjoin(User, User.id == Custody.rep_id)
        .where(Custody.holder_type == HolderType.rep, Custody.account_id.is_not(None))
        .order_by(Custody.id)
    ).all():
        box = _safe_box(c, acc, rep)
        if branch_id is not None and box.branch_id not in (branch_id, None):
            continue
        out.append(box)
    if active_only:
        out = [b for b in out if b.active]
    return out


def resolve(db: Session, key: str) -> Box:
    kind, _, raw = (key or "").partition("-")
    if not raw.isdigit():
        raise CashBoxError("الخزينة غير موجودة.")
    ident = int(raw)
    if kind == "t":
        t = db.get(Treasury, ident)
        if t is None:
            raise CashBoxError("الخزينة غير موجودة.")
        return _treasury_box(t)
    if kind == "c":
        c = db.get(Custody, ident)
        if c is None or c.account_id is None or c.holder_type != HolderType.rep:
            raise CashBoxError("الصندوق غير موجود.")
        acc = db.get(Account, c.account_id)
        rep = db.get(User, c.rep_id) if c.rep_id else None
        return _safe_box(c, acc, rep)
    raise CashBoxError("الخزينة غير موجودة.")


def box_out(db: Session, b: Box) -> dict:
    return {
        "key": b.key, "kind": b.kind, "name": b.name, "account_id": b.account_id,
        "treasury_id": b.treasury_id, "custody_id": b.custody_id, "branch_id": b.branch_id,
        "rep_id": b.rep_id, "rep_name": b.rep_name, "family": b.family, "active": b.active,
        "balance": str(ledger_service.balance_of(db, b.account_id)),
    }
