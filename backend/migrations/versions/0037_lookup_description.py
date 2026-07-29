"""وصف على خيار القائمة — a5 parity: فئات الأصناف carry a وصف.

On the lookup rather than a new category table, because the lookup already IS the list: it holds
the name, the order and the hidden flag. A second table for one extra field would be two places
holding the same list, and they would drift.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037_lookup_description"
down_revision = "0036_invoice_expenses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lookup_option", sa.Column("description", sa.String(300), nullable=True))


def downgrade() -> None:
    op.drop_column("lookup_option", "description")
