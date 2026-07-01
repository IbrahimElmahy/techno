"""T020: the 0010 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0010_limits_batches.py"
    spec = importlib.util.spec_from_file_location("mig0010", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_0009():
    mod = _load()
    assert mod.down_revision == "0009_barcodes"
    assert mod.revision == "0010_limits_batches"


def test_stock_batch_in_metadata():
    from src.core.db import Base

    assert "stock_batch" in Base.metadata.tables


def test_item_gains_limit_and_perishable_columns():
    from src.models.catalog import Item

    cols = Item.__table__.columns
    assert "min_stock" in cols
    assert "max_stock" in cols
    assert "is_perishable" in cols
    # Additive: new item columns are nullable or defaulted (no backfill needed).
    assert cols["min_stock"].nullable
    assert cols["max_stock"].nullable
