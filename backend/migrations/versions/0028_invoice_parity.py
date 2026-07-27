"""Per-line warehouse, frozen sale cost, and document fields on sale/purchase documents — 030.

The warehouse moves from the document down to the LINE, so one invoice can be served out of
several warehouses. Existing documents are not touched destructively: the upgrade backfills each
old line with its document's warehouse, so every line has a warehouse afterwards and nothing has
to special-case "old rows".

`unit_cost` freezes the cost of goods at the moment of sale — later purchases move the average,
but a past invoice's profit must not move with them. It stays NULL on rows written before this
migration, because the average cost at that moment is not recoverable; profit reports show those
as "no captured cost" rather than inventing a number.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028_invoice_parity"
down_revision = "0027_standalone_sales_return"
branch_labels = None
depends_on = None


_DOC_FIELDS = [
    ("rep_id", sa.BigInteger()),
    ("external_document_number", sa.String(40)),
    ("notes", sa.String(500)),
    ("statement1", sa.String(200)),
    ("statement2", sa.String(200)),
    ("statement3", sa.String(200)),
]


def upgrade() -> None:
    # --- documents: who sold it, where it posts, and the paper trail ---
    for table, account_col in (("sales_invoice", "revenue_account_id"),
                               ("sales_return", "revenue_account_id"),
                               ("purchase_invoice", "expense_account_id")):
        for name, type_ in _DOC_FIELDS:
            op.add_column(table, sa.Column(name, type_, nullable=True))
        op.add_column(table, sa.Column(account_col, sa.BigInteger(), nullable=True))
        op.create_index(f"ix_{table}_external_doc", table, ["external_document_number"])

    # --- lines: the warehouse each line actually moved through ---
    op.add_column("sales_invoice_line", sa.Column("location_kind", sa.String(20), nullable=True))
    op.add_column("sales_invoice_line", sa.Column("location_id", sa.BigInteger(), nullable=True))
    op.add_column("sales_invoice_line", sa.Column("unit_cost", sa.Numeric(18, 2), nullable=True))

    op.add_column("sales_return_line", sa.Column("location_kind", sa.String(20), nullable=True))
    op.add_column("sales_return_line", sa.Column("location_id", sa.BigInteger(), nullable=True))
    op.add_column("sales_return_line", sa.Column("unit_cost", sa.Numeric(18, 2), nullable=True))

    op.add_column("purchase_invoice_line",
                  sa.Column("line_location_kind", sa.String(20), nullable=True))
    op.add_column("purchase_invoice_line",
                  sa.Column("line_location_id", sa.BigInteger(), nullable=True))

    # --- backfill: every existing line inherits its document's warehouse ---
    op.execute("""
        UPDATE sales_invoice_line l
        JOIN sales_invoice i ON i.id = l.invoice_id
        SET l.location_kind = i.origin_location_kind, l.location_id = i.origin_location_id
        WHERE l.location_id IS NULL
    """ if op.get_bind().dialect.name in ("mysql", "mariadb") else """
        UPDATE sales_invoice_line
        SET location_kind = i.origin_location_kind, location_id = i.origin_location_id
        FROM sales_invoice i
        WHERE i.id = sales_invoice_line.invoice_id AND sales_invoice_line.location_id IS NULL
    """)

    # An invoice-bound return went back to the invoice's warehouse; a standalone one carries
    # its own origin (028).
    op.execute("""
        UPDATE sales_return_line l
        JOIN sales_return r ON r.id = l.return_id
        LEFT JOIN sales_invoice i ON i.id = r.sales_invoice_id
        SET l.location_kind = COALESCE(r.origin_location_kind, i.origin_location_kind),
            l.location_id   = COALESCE(r.origin_location_id, i.origin_location_id)
        WHERE l.location_id IS NULL
    """ if op.get_bind().dialect.name in ("mysql", "mariadb") else """
        UPDATE sales_return_line
        SET location_kind = COALESCE(r.origin_location_kind, i.origin_location_kind),
            location_id   = COALESCE(r.origin_location_id, i.origin_location_id)
        FROM sales_return r LEFT JOIN sales_invoice i ON i.id = r.sales_invoice_id
        WHERE r.id = sales_return_line.return_id AND sales_return_line.location_id IS NULL
    """)

    op.execute("""
        UPDATE purchase_invoice_line l
        JOIN purchase_invoice i ON i.id = l.invoice_id
        SET l.line_location_kind = i.location_kind, l.line_location_id = i.location_id
        WHERE l.line_location_id IS NULL
    """ if op.get_bind().dialect.name in ("mysql", "mariadb") else """
        UPDATE purchase_invoice_line
        SET line_location_kind = i.location_kind, line_location_id = i.location_id
        FROM purchase_invoice i
        WHERE i.id = purchase_invoice_line.invoice_id
          AND purchase_invoice_line.line_location_id IS NULL
    """)


def downgrade() -> None:
    op.drop_column("purchase_invoice_line", "line_location_id")
    op.drop_column("purchase_invoice_line", "line_location_kind")
    for table in ("sales_return_line", "sales_invoice_line"):
        op.drop_column(table, "unit_cost")
        op.drop_column(table, "location_id")
        op.drop_column(table, "location_kind")
    for table, account_col in (("purchase_invoice", "expense_account_id"),
                               ("sales_return", "revenue_account_id"),
                               ("sales_invoice", "revenue_account_id")):
        op.drop_index(f"ix_{table}_external_doc", table_name=table)
        op.drop_column(table, account_col)
        for name, _ in reversed(_DOC_FIELDS):
            op.drop_column(table, name)
