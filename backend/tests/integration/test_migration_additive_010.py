"""T011: the 0009 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0009_barcodes.py"
    spec = importlib.util.spec_from_file_location("mig0009", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_009():
    mod = _load()
    assert mod.down_revision == "0008_serials"
    assert mod.revision == "0009_barcodes"


def test_item_barcode_in_metadata():
    from src.core.db import Base

    assert "item_barcode" in Base.metadata.tables


def test_barcode_unique():
    from src.models.catalog import ItemBarcode

    assert ItemBarcode.__table__.columns["barcode"].unique
