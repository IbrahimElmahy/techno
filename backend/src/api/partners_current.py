"""«جاري الشركاء» — شاشة a5 «الجاري» (٢٠٢٦-١٠-٠٦).

الحسابات نفسها متنقلة من a5 بأرصدتها (تحت «جارى الشركاء» وسنواته، و«رأس المال»،
و«استثمار»)، بس ماكانش ليها مكان يتشاف فيه غير شجرة الحسابات — والمحاسب اللي متعوّد على
شاشة «الجاري» عند a5 مالقاهاش ومالقاش أرصدة الشركاء.

الحساب هنا هو الحساب بتاع a5 زي ما هو — مافيش جدول تاني ولا رصيد بيتحسب بطريقة تانية.
الرصيد دائن بالموجب (الشريك ليه)، والمدين بالسالب (عليه) — اتجاه حسابات رأس المال.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LEDGER_READ
from src.core.db import get_db
from src.core.money import to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.models.org import Branch

router = APIRouter(tags=["partners-current"])

# المجموعات في شجرة a5: «جارى الشركاء» وكل سنة ليها مجموعة («جارى الشركاء.2026.2025»)،
# و«رأس المال»، و«استثمار». بالاسم لأن رقم المجموعة بيختلف من فرع لفرع.
GROUP_PATTERNS = ("%جار%", "%رأس المال%", "%راس المال%", "%استثمار%")


class PartnerAccountOut(BaseModel):
    account_id: int
    code: str | None
    name: str
    group_id: int
    group_name: str
    branch_id: int | None
    branch_name: str | None
    debit: Decimal
    credit: Decimal
    balance: Decimal          # دائن − مدين: موجب = للشريك، سالب = عليه
    lines: int
    last_date: date | None


@router.get("/partners-current", response_model=list[PartnerAccountOut])
def partners_current(
    as_of: date | None = Query(None, description="الرصيد لحد التاريخ ده"),
    include_zero: bool = Query(False),
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_READ)),
    db: Session = Depends(get_db),
) -> list[PartnerAccountOut]:
    parent = aliased(Account)
    stmt = (
        select(Account, parent)
        .join(parent, parent.id == Account.parent_id)
        .where(or_(*[parent.name.like(p) for p in GROUP_PATTERNS]))
    )
    bid = branch_scope.visible_branch_id(current)
    if bid is not None:
        stmt = stmt.where(Account.branch_id == bid)
    pairs = db.execute(stmt).all()
    if not pairs:
        return []
    ids = [a.id for a, _p in pairs]

    sums = (
        select(
            LedgerLine.account_id,
            func.coalesce(func.sum(LedgerLine.amount).filter(
                LedgerLine.direction == Direction.debit), 0),
            func.coalesce(func.sum(LedgerLine.amount).filter(
                LedgerLine.direction == Direction.credit), 0),
            func.count(LedgerLine.id),
            func.max(LedgerEntry.entry_date),
        )
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(ids),
               or_(LedgerEntry.state.is_(None), LedgerEntry.state == "posted"))
        .group_by(LedgerLine.account_id)
    )
    if as_of is not None:
        sums = sums.where(LedgerEntry.entry_date <= as_of)
    by_acc = {r[0]: r[1:] for r in db.execute(sums).all()}
    branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}

    out: list[PartnerAccountOut] = []
    for a, p in pairs:
        dr, cr, n, last = by_acc.get(a.id, (0, 0, 0, None))
        dr, cr = to_money(Decimal(str(dr))), to_money(Decimal(str(cr)))
        if not include_zero and n == 0:
            continue
        out.append(PartnerAccountOut(
            account_id=a.id, code=a.code, name=a.name or "", group_id=p.id,
            group_name=p.name or "", branch_id=a.branch_id,
            branch_name=branches.get(a.branch_id), debit=dr, credit=cr,
            balance=to_money(cr - dr), lines=int(n or 0), last_date=last,
        ))
    out.sort(key=lambda r: (r.branch_id or 0, r.group_name, r.name))
    return out
