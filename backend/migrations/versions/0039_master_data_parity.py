"""حقول البيانات الأساسية الناقصة — a5 parity, read off their screens field by field.

* **المورد**: فرع ومحافظة ومدينة. The customer has carried all three since 001; the supplier was
  the thinner record for no reason other than that nobody had asked for it.
* **المخزن**: وصف. «مخزن السيارة أ» explains itself; «مخزن ٣» does not.
* **الموظف**: المخزن. Their الموظفين list shows a store per employee — it is how "who is
  responsible for this stock" is answered without reading a custody document.

All nullable and additive.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0039_master_data_parity"
down_revision = "0038_item_packing_tier_allowances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("supplier", sa.Column("branch_id", sa.BigInteger(),
                                        sa.ForeignKey("branch.id"), nullable=True))
    op.add_column("supplier", sa.Column("governorate_id", sa.BigInteger(),
                                        sa.ForeignKey("governorate.id"), nullable=True))
    op.add_column("supplier", sa.Column("markaz", sa.String(120), nullable=True))
    op.add_column("warehouse", sa.Column("description", sa.String(300), nullable=True))
    op.add_column("employee", sa.Column("warehouse_id", sa.BigInteger(),
                                        sa.ForeignKey("warehouse.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("employee", "warehouse_id")
    op.drop_column("warehouse", "description")
    op.drop_column("supplier", "markaz")
    op.drop_column("supplier", "governorate_id")
    op.drop_column("supplier", "branch_id")
