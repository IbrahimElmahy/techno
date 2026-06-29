"""T018: the 0006 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0006_price_tiers.py"
    spec = importlib.util.spec_from_file_location("mig0006", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_006():
    mod = _load()
    assert mod.down_revision == "0005_cost_centers"
    assert mod.revision == "0006_price_tiers"


def test_item_price_table_in_metadata():
    from src.core.db import Base

    assert "item_price" in Base.metadata.tables


def test_columns_added():
    from src.models.customer import Customer
    from src.models.sales import SalesInvoiceLine

    assert "default_price_tier" in Customer.__table__.columns
    assert "price_tier" in SalesInvoiceLine.__table__.columns


def test_price_tier_enum_has_five_values():
    from src.models.catalog import PriceTier

    assert {t.value for t in PriceTier} == {
        "commercial", "semi_commercial", "wholesale", "semi_wholesale", "consumer"
    }


def test_item_price_unique_item_tier():
    from src.models.catalog import ItemPrice

    uniques = {tuple(sorted(c.name for c in con.columns))
               for con in ItemPrice.__table__.constraints
               if con.__class__.__name__ == "UniqueConstraint"}
    assert ("item_id", "tier") in uniques
