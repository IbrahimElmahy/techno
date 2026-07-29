"""حقول مستند الإنتاج: التاريخ · الفرع · امر تشغيل · ملاحظات.

Read off their انتاج حسب النسب header. The production date is the important one: a workshop closes a
batch in the evening and the office types it the next morning, and dating the document by entry puts
the output in the wrong day on every production report — a disagreement that only surfaces when
somebody reconciles a month that is already closed.

Existing orders get their production date from `created_at`, which is the best available answer and
the one that was implicitly being used anyway.

Revision ID: 0042_production_document_fields
Revises: 0041_bom_component_unit
"""
from alembic import op
import sqlalchemy as sa

revision = "0042_production_document_fields"
down_revision = "0041_bom_component_unit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("manufacturing_order", sa.Column("production_date", sa.Date(), nullable=True))
    op.add_column("manufacturing_order", sa.Column("branch_id", sa.BigInteger(), nullable=True))
    op.add_column("manufacturing_order",
                  sa.Column("work_order_ref", sa.String(length=60), nullable=True))
    op.add_column("manufacturing_order", sa.Column("notes", sa.String(length=500), nullable=True))
    op.create_index("ix_manufacturing_order_branch_id", "manufacturing_order", ["branch_id"])
    op.execute("UPDATE manufacturing_order SET production_date = DATE(created_at) "
               "WHERE production_date IS NULL")


def downgrade() -> None:
    op.drop_index("ix_manufacturing_order_branch_id", table_name="manufacturing_order")
    for col in ("notes", "work_order_ref", "branch_id", "production_date"):
        op.drop_column("manufacturing_order", col)
