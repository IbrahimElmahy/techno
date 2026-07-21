"""Per-branch chart of accounts — 024-multi-branch (phase 1).

Each account belongs to a branch. Existing accounts are homed to the main branch by the
startup backfill (idempotent), so balances and behaviour are unchanged for a single-branch
company; adding more branches gives each its own full chart.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024_account_branch"
down_revision = "0023_inspection_item_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("account", sa.Column("branch_id", sa.BigInteger(),
                                       sa.ForeignKey("branch.id"), nullable=True))
    op.create_index("ix_account_branch_id", "account", ["branch_id"])


def downgrade() -> None:
    op.drop_index("ix_account_branch_id", "account")
    op.drop_column("account", "branch_id")
