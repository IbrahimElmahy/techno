"""وحدة لكل خامة في الوصفة.

A recipe component used to be base units only, so anyone writing «٢ كرتونة» had to convert it by
hand — the exact arithmetic that 008 (multiple units of measure) exists to remove. The pair matches
what sale, return and purchase lines already carry, so «في أي وحدة؟» is answered one way system-wide.

Existing rows default to NULL/1, meaning the base unit — which is what they have always meant, so
no recipe changes what it consumes.

Revision ID: 0041_bom_component_unit
Revises: 0040_account_main_level
"""
from alembic import op
import sqlalchemy as sa

revision = "0041_bom_component_unit"
down_revision = "0040_account_main_level"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bom_component", sa.Column("unit", sa.String(length=16), nullable=True))
    op.add_column("bom_component", sa.Column(
        "unit_factor", sa.Numeric(18, 3), nullable=False, server_default="1"))


def downgrade() -> None:
    op.drop_column("bom_component", "unit_factor")
    op.drop_column("bom_component", "unit")
