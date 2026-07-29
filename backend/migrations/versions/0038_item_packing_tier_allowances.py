"""تعبئة الصنف ووصفه + خصم وضريبة لكل فئة سعر + سعر اللستة (a5 parity).

Three things their الأصناف screen has that ours did not:

* the packing — one selling unit holds N pieces, and the piece has its own name;
* a discount AND a VAT rate per price tier, because a wholesaler and a walk-in do not get the
  same allowance and one rate on the item would force the salesman to re-derive the difference;
* a sixth tier, سعر اللستة — the published price quoted from, which is not one of the five
  negotiated ones, and which a salesman needs beside the tier a customer actually gets.

The tier column is a native enum on MySQL, so the new member widens it in place. On SQLite it is
a string and nothing has to happen — which is exactly why the widening is declared for the server
rather than left to the tests to notice.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0038_item_packing_tier_allowances"
down_revision = "0037_lookup_description"
branch_labels = None
depends_on = None

_TIERS = "'commercial','semi_commercial','wholesale','semi_wholesale','consumer','list_price'"


def upgrade() -> None:
    op.add_column("item", sa.Column("piece_name", sa.String(32), nullable=True))
    op.add_column("item", sa.Column("pieces_per_unit", sa.Numeric(18, 3), nullable=True))
    op.add_column("item", sa.Column("description", sa.String(500), nullable=True))

    op.add_column("item_price", sa.Column("discount_pct", sa.Numeric(5, 2),
                                          nullable=False, server_default="0"))
    op.add_column("item_price", sa.Column("vat_pct", sa.Numeric(5, 2),
                                          nullable=False, server_default="0"))

    if op.get_bind().dialect.name == "mysql":
        op.execute(f"ALTER TABLE item_price MODIFY tier ENUM({_TIERS}) NOT NULL")


def downgrade() -> None:
    op.drop_column("item_price", "vat_pct")
    op.drop_column("item_price", "discount_pct")
    op.drop_column("item", "description")
    op.drop_column("item", "pieces_per_unit")
    op.drop_column("item", "piece_name")
