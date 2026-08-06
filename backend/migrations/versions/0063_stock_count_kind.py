"""نوع الجرد — كلي · دوري · عينة.

The three differ in exactly one thing: which items land on the sheet. After that they are the same
document — count, difference, post — which is why they are one code path rather than three
near-identical screens that would each drift.

Recorded on the document rather than inferred from its contents: «ليه الصنف ده مش في الجردة؟» is a
question the kind answers, and a cycle count mistaken for a failed full count is how people stop
trusting the numbers.

Defaulted to `full`, which is what every sheet written before today was.

Revision ID: 0063_stock_count_kind
Revises: 0062_transfer_lines
"""
from alembic import op
import sqlalchemy as sa

revision = "0063_stock_count_kind"
down_revision = "0062_transfer_lines"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stock_count", sa.Column(
        "kind", sa.Enum("full", "cycle", "spot", name="stockcountkind"),
        nullable=False, server_default="full"))


def downgrade() -> None:
    op.drop_column("stock_count", "kind")
