"""Review-screen parity (015 follow-up): warranty certificate number (legacy sequence),
accepted/rejected status (reject = the system's no-delete alternative), نوع الزيارة
(معاينة/مرمة lookup), and print tracking for الشهادة.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_inspection_review"
down_revision = "0016_inspection_custody"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inspection", sa.Column("certificate_number", sa.BigInteger(), nullable=True))
    op.create_index("ix_inspection_certificate_number", "inspection", ["certificate_number"])
    op.add_column("inspection", sa.Column("visit_type", sa.String(40), nullable=False,
                                          server_default="معاينة"))
    op.add_column("inspection", sa.Column("status", sa.String(12), nullable=False,
                                          server_default="accepted"))
    op.add_column("inspection", sa.Column("printed", sa.Boolean(), nullable=False,
                                          server_default=sa.false()))
    op.add_column("inspection", sa.Column("printed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("inspection", "printed_at")
    op.drop_column("inspection", "printed")
    op.drop_column("inspection", "status")
    op.drop_column("inspection", "visit_type")
    op.drop_index("ix_inspection_certificate_number", "inspection")
    op.drop_column("inspection", "certificate_number")
