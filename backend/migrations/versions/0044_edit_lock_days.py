"""قفل تعديل المستندات (أيام).

A rolling companion to the hard period lock, not a replacement. The lock is a deliberate act on a
date the accountant chooses, and it only ever protects a month somebody remembered to close; this
closes the ordinary user's window by itself, so last month's invoice cannot be quietly reversed on a
busy Tuesday and change a figure already reported.

NULL means off, which is what every existing deployment gets — nothing changes until an admin sets a
number.

Revision ID: 0044_edit_lock_days
Revises: 0043_account_routing
"""
from alembic import op
import sqlalchemy as sa

revision = "0044_edit_lock_days"
down_revision = "0043_account_routing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_setting", sa.Column("edit_lock_days", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("sales_setting", "edit_lock_days")
