"""Regular visits link to a chosen customer (022).

The «زيارة عادية» in the legacy app selects an existing customer instead of typing an owner.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_inspection_customer"
down_revision = "0021_tax_commissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inspection", sa.Column("customer_id", sa.BigInteger(),
                                          sa.ForeignKey("customer.id"), nullable=True))
    op.create_index("ix_inspection_customer_id", "inspection", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_inspection_customer_id", "inspection")
    op.drop_column("inspection", "customer_id")
