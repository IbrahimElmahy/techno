"""T040: the 0003 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path

from src.core.db import Base


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0003_after_sales_loyalty.py"
    spec = importlib.util.spec_from_file_location("mig0003", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_002():
    mod = _load()
    assert mod.down_revision == "0002_sales_inventory"
    assert mod.revision == "0003_after_sales_loyalty"


def test_new_tables_in_metadata():
    mod = _load()
    for name in mod._NEW_TABLES:
        assert name in Base.metadata.tables, f"missing {name}"


def test_account_enum_includes_loyalty_expense():
    from src.models.ledger import AccountType

    assert "loyalty_expense" in {a.value for a in AccountType}


def test_expected_indexes_and_unique(db):
    # T043: hot lookups indexed; coupon serial unique.
    from src.models.loyalty import Coupon, PointRecord

    assert PointRecord.__table__.columns["customer_id"].index
    assert Coupon.__table__.columns["serial"].unique
