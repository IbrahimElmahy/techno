"""بيان ١ و بيان ٢ على الفرع.

Read off their الفروع form, which asks for exactly three things: الاسم · بيان 1 · بيان 2.

The two notes are deliberately unnamed and unvalidated. A branch accumulates facts that belong to
no column — a landlord's number, a licence reference, «التسليم من باب المخزن مش الشارع» — and
giving them a shape now would only be a shape somebody has to work around later. Their form
leaves them as two free lines; so do we.

Note what their form does NOT have: a governorate. Ours requires one and keeps it — dropping a
required column that already holds data, to match a layout, is a straight loss.

Revision ID: 0048_branch_notes
Revises: 0047_supplier_card_fields
"""
from alembic import op
import sqlalchemy as sa

revision = "0048_branch_notes"
down_revision = "0047_supplier_card_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("branch", sa.Column("note1", sa.String(length=300), nullable=True))
    op.add_column("branch", sa.Column("note2", sa.String(length=300), nullable=True))


def downgrade() -> None:
    op.drop_column("branch", "note2")
    op.drop_column("branch", "note1")
