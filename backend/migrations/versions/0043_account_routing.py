"""التوجيه المحاسبي — جدول توجيه الأدوار للحسابات.

Every posting names a role («sales revenue»), not an account, and until now each role resolved to an
account this system seeded itself. Safe, because it cannot be misconfigured — and wrong for a client
whose accountant already has a chart and wants revenue on their own revenue account, where their
auditor expects to find it.

A table rather than a column on `account`: the relationship is «one role → one account», so a column
would let two accounts claim the same role with nothing to stop them, and which of them received
today's sales would depend on row order. The unique constraint says it once, in the database, because
the failure it prevents is silent — the ledger stays balanced and the income statement is just wrong.

Nothing is inserted. No row for a role means the seeded default, exactly as before, so an existing
deployment posts identically until somebody deliberately changes something.

Revision ID: 0043_account_routing
Revises: 0042_production_document_fields
"""
from alembic import op
import sqlalchemy as sa

revision = "0043_account_routing"
down_revision = "0042_production_document_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_routing",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("role", sa.String(length=48), nullable=False),
        sa.Column("account_id", sa.BigInteger(), sa.ForeignKey("account.id"), nullable=False),
        sa.Column("branch_id", sa.BigInteger(), sa.ForeignKey("branch.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("role", "branch_id", name="uq_account_routing_role_branch"),
    )
    op.create_index("ix_account_routing_role", "account_routing", ["role"])


def downgrade() -> None:
    op.drop_index("ix_account_routing_role", table_name="account_routing")
    op.drop_table("account_routing")
