"""التوجيه المحاسبي — which account each posting role uses.

Every posting in the system names a *role*, not an account: «sales revenue», «customer receivable»,
«cost of sales». Until now each role resolved to one account this system had seeded itself, which is
safe — it cannot be misconfigured — and wrong for a client whose accountant already has a chart and
wants revenue landing on *their* revenue account, in *their* numbering, where their auditor expects
it. Forcing them to keep a parallel account they never asked for is how a system gets abandoned in
favour of the spreadsheet beside it.

So a role may be *pointed* at an account. The override is a separate table rather than a column on
`account`, because the relationship is «one role → one account», not «this account has a role»: a
column would let two accounts claim the same role with nothing to stop them, and then which one
receives today's sales depends on row order.

The default stays: no row for a role means the seeded singleton, exactly as before. Nothing has to
be configured for the system to post correctly, and a client who configures nothing sees no change.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.core.db import Base, BigIntPK


class AccountRouting(Base):
    """One role pointed at one account, per branch.

    Per branch because a branch keeps its own books (024): the main branch's revenue account is not
    the second branch's, and a single company-wide override would merge two branches' revenue into
    whichever account was configured last.
    """

    __tablename__ = "account_routing"
    __table_args__ = (
        # One account per role per branch — enforced in the database, not just in the service,
        # because the failure it prevents (two accounts claiming «sales revenue») is silent: the
        # ledger stays balanced and the income statement is simply wrong.
        UniqueConstraint("role", "branch_id", name="uq_account_routing_role_branch"),
    )

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # The posting role, e.g. "sales_revenue". A string rather than an enum column: the set of roles
    # grows every time a module posts something new, and a stored enum would need a migration for
    # each one while the code already knows the full list.
    role: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
