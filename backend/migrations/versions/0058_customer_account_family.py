"""العميل يقدر يشيل أكتر من حساب — واحد لكل عيلة منتجات.

The client sells two lines, «أبيض» and «بولي», at different commissions. Their old system modelled
that by opening the same person TWICE — «محمد عامر» and «تكنو محمد عامر» — because a customer could
hold only one receivable account. Two customers for one man means his address is typed twice, his
phone twice, and «هو مديون بكام؟» has two answers with no way to add them.

The person becomes one customer and the split moves onto the account, where it belongs.

Two changes, and the first is the one that mattered:

* **the UNIQUE on `customer_id` alone is dropped.** That constraint WAS the reason a second
  customer had to be opened to get a second account. It becomes UNIQUE (customer_id, family).
* `family` and `commission_pct` are added, both nullable.

`family` NULL is a real value, not a gap: it means «this customer's one account», which is what
every customer had until now. SQL does not compare NULLs in a UNIQUE, so every existing row keeps
working and `Customer.account` — scoped to `family IS NULL` — answers exactly as it did.

Revision ID: 0058_customer_account_family
Revises: 0057_purchase_return_date
"""
from alembic import op
import sqlalchemy as sa

revision = "0058_customer_account_family"
down_revision = "0057_purchase_return_date"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("customer_account", sa.Column("family", sa.String(40), nullable=True))
    op.add_column("customer_account",
                  sa.Column("commission_pct", sa.Numeric(9, 4), nullable=True))
    # The old constraint is named differently across the databases this has run on, so it is
    # dropped by inspection rather than by a name that may not exist.
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for uc in insp.get_unique_constraints("customer_account"):
        if uc.get("column_names") == ["customer_id"]:
            op.drop_constraint(uc["name"], "customer_account", type_="unique")
    op.create_unique_constraint(
        "uq_customer_account_family", "customer_account", ["customer_id", "family"])
    op.create_index("ix_customer_account_customer_id", "customer_account", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_customer_account_customer_id", table_name="customer_account")
    op.drop_constraint("uq_customer_account_family", "customer_account", type_="unique")
    op.create_unique_constraint(
        "uq_customer_account_customer", "customer_account", ["customer_id"])
    op.drop_column("customer_account", "commission_pct")
    op.drop_column("customer_account", "family")
