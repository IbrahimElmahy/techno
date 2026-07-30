"""حقول بطاقة العميل: الفرع · البريد · الرقم الضريبي · السجل التجاري · خصم · ض.م · نقدي.

Read off their العملاء form. Three notes on the choices:

* **الفرع is nullable** even though it is the first column on their list. A customer recorded
  before the field existed is not made invalid by it, and defaulting everyone to one branch would
  invent an assignment nobody made.
* **خصم and ض.م are NULL, not 0, when unset.** NULL means "nothing agreed — use whatever the item
  or line says"; 0 means "agreed, and it is zero". A customer who negotiated 0% is a different
  fact from one nobody has negotiated with, and collapsing the two loses the difference for good.
* **نقدي is NOT NULL default false.** Unlike the others it is a yes/no about how the customer
  pays, and "unknown" is not a third state anyone would act on differently from "no".

Revision ID: 0046_customer_card_fields
Revises: 0045_employee_card_fields
"""
from alembic import op
import sqlalchemy as sa

revision = "0046_customer_card_fields"
down_revision = "0045_employee_card_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customer", sa.Column("branch_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_customer_branch", "customer", "branch", ["branch_id"], ["id"]
    )
    op.add_column("customer", sa.Column("email", sa.String(length=160), nullable=True))
    op.add_column("customer", sa.Column("tax_number", sa.String(length=40), nullable=True))
    op.add_column("customer", sa.Column("commercial_register", sa.String(length=40), nullable=True))
    op.add_column("customer", sa.Column("discount_pct", sa.Numeric(5, 2), nullable=True))
    op.add_column("customer", sa.Column("vat_pct", sa.Numeric(5, 2), nullable=True))
    op.add_column(
        "customer",
        sa.Column("is_cash", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("customer", "is_cash")
    op.drop_column("customer", "vat_pct")
    op.drop_column("customer", "discount_pct")
    op.drop_column("customer", "commercial_register")
    op.drop_column("customer", "tax_number")
    op.drop_column("customer", "email")
    op.drop_constraint("fk_customer_branch", "customer", type_="foreignkey")
    op.drop_column("customer", "branch_id")
