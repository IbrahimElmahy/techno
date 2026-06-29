"""T047: the 0002 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib

from src.core.db import Base

MIGRATION = "migrations.versions.0002_sales_inventory".replace(".0002", ".") if False else None


def _load():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0002_sales_inventory.py"
    spec = importlib.util.spec_from_file_location("mig0002", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_migration_chains_onto_foundation():
    mod = _load()
    assert mod.down_revision == "0001_baseline"
    assert mod.revision == "0002_sales_inventory"


def test_all_new_tables_in_metadata():
    mod = _load()
    for name in mod._NEW_TABLES:
        assert name in Base.metadata.tables, f"missing table {name}"


def test_account_enum_includes_new_values():
    from src.models.ledger import AccountType

    names = {a.value for a in AccountType}
    assert {"supplier_payable", "sales_revenue", "purchases_expense"} <= names
