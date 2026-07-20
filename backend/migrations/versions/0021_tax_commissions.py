"""VAT (opt-in) + rep commission rules — 021-tax-commissions.

`vat_rate_pct` ships at 0, which makes invoice posting byte-identical to the pre-VAT
behaviour; enabling tax is a deliberate settings change.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_tax_commissions"
down_revision = "0020_cheques"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_setting", sa.Column("vat_rate_pct", sa.Numeric(5, 2), nullable=False,
                                             server_default="0"))
    op.add_column("sales_invoice", sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False,
                                             server_default="0"))
    op.create_table(
        "commission_rule",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("rep_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=True,
                  unique=True),
        sa.Column("rate_pct", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("basis", sa.String(12), nullable=False, server_default="collection"),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("commission_rule")
    op.drop_column("sales_invoice", "tax_amount")
    op.drop_column("sales_setting", "vat_rate_pct")
