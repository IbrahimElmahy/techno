"""T016: the 0011 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0011_credit_limits.py"
    spec = importlib.util.spec_from_file_location("mig0011", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_0010():
    mod = _load()
    assert mod.down_revision == "0010_limits_batches"
    assert mod.revision == "0011_credit_limits"


def test_customer_gains_credit_columns():
    from src.models.customer import Customer

    cols = Customer.__table__.columns
    assert "credit_limit" in cols
    assert "max_due_term_days" in cols
    assert cols["credit_limit"].nullable
    assert cols["max_due_term_days"].nullable


def test_sales_invoice_gains_due_date():
    from src.models.sales import SalesInvoice

    cols = SalesInvoice.__table__.columns
    assert "due_date" in cols
    assert cols["due_date"].nullable
