"""حقول بطاقة المورد: تصنيف · البريد · الرقم الضريبي · السجل التجاري · نقدي.

Read off their الموردين form. The supplier record already carried الفرع، محافظه، مدينة، العنوان
والهاتف; these five are what was left.

* **تصنيف is a free string, not an enum** — same as the customer's (013). Admins add their own
  kinds from Settings, and no business logic branches on it.
* **No خصم, no ض.م, no default price tier.** Their supplier form has none of the three, unlike
  their customer form. That is a real difference in how a supplier is dealt with rather than
  something missing from their screen, so it is not invented here.
* **نقدي is NOT NULL default false**, like the customer's: «unknown» is not a third state anyone
  would act on differently from «no». The rest are nullable — an existing supplier is not made
  invalid by fields nobody has filled yet.

Revision ID: 0047_supplier_card_fields
Revises: 0046_customer_card_fields
"""
from alembic import op
import sqlalchemy as sa

revision = "0047_supplier_card_fields"
down_revision = "0046_customer_card_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("supplier", sa.Column("supplier_type", sa.String(length=32), nullable=True))
    op.add_column("supplier", sa.Column("email", sa.String(length=160), nullable=True))
    op.add_column("supplier", sa.Column("tax_number", sa.String(length=40), nullable=True))
    op.add_column("supplier", sa.Column("commercial_register", sa.String(length=40), nullable=True))
    op.add_column(
        "supplier",
        sa.Column("is_cash", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("supplier", "is_cash")
    op.drop_column("supplier", "commercial_register")
    op.drop_column("supplier", "tax_number")
    op.drop_column("supplier", "email")
    op.drop_column("supplier", "supplier_type")
