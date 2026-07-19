"""Site inspections / معاينات (015-inspections-mobile).

Two new tables: `inspection` (technician/regular visit header, offline-sync `client_uuid`) and
`inspection_item` (item lines with points × quantity). Informational only — no stock/ledger.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015_inspections"
down_revision = "0014_item_discount"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inspection",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_number", sa.String(24), nullable=False, unique=True),
        sa.Column("client_uuid", sa.String(40), nullable=True, unique=True),
        sa.Column("visit_kind", sa.String(16), nullable=False),
        sa.Column("inspection_date", sa.Date(), nullable=False),
        sa.Column("owner_name", sa.String(160), nullable=False),
        sa.Column("owner_phone", sa.String(32), nullable=True),
        sa.Column("national_id", sa.String(20), nullable=True),
        sa.Column("owner_address", sa.String(240), nullable=True),
        sa.Column("floor_number", sa.String(16), nullable=True),
        sa.Column("description", sa.String(80), nullable=True),
        sa.Column("inspection_type", sa.String(80), nullable=True),
        sa.Column("technician_name", sa.String(160), nullable=True),
        sa.Column("technician_phone", sa.String(32), nullable=True),
        sa.Column("purchase_shop", sa.String(160), nullable=True),
        sa.Column("visit_details", sa.String(1000), nullable=True),
        sa.Column("total_points", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("rep_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inspection_rep_user_id", "inspection", ["rep_user_id"])
    op.create_table(
        "inspection_item",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("inspection_id", sa.BigInteger(), sa.ForeignKey("inspection.id"),
                  nullable=False),
        sa.Column("item_id", sa.BigInteger(), sa.ForeignKey("item.id"), nullable=True),
        sa.Column("item_name", sa.String(160), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("points", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(18, 3), nullable=False, server_default="0"),
    )
    op.create_index("ix_inspection_item_inspection_id", "inspection_item", ["inspection_id"])


def downgrade() -> None:
    op.drop_table("inspection_item")
    op.drop_table("inspection")
