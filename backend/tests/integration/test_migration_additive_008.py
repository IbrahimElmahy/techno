"""T019: the 0007 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0007_item_units.py"
    spec = importlib.util.spec_from_file_location("mig0007", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_007():
    mod = _load()
    assert mod.down_revision == "0006_price_tiers"
    assert mod.revision == "0007_item_units"


def test_item_unit_table_in_metadata():
    from src.core.db import Base

    assert "item_unit" in Base.metadata.tables


def test_line_columns_added():
    from src.models.purchasing import PurchaseInvoiceLine
    from src.models.sales import SalesInvoiceLine

    for col in ("unit", "unit_factor"):
        assert col in SalesInvoiceLine.__table__.columns
        assert col in PurchaseInvoiceLine.__table__.columns


def test_item_unit_unique_item_name():
    from src.models.catalog import ItemUnit

    uniques = {tuple(sorted(c.name for c in con.columns))
               for con in ItemUnit.__table__.constraints
               if con.__class__.__name__ == "UniqueConstraint"}
    assert ("item_id", "name") in uniques
