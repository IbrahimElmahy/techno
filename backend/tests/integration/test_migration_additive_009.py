"""T017: the 0008 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0008_serials.py"
    spec = importlib.util.spec_from_file_location("mig0008", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_008():
    mod = _load()
    assert mod.down_revision == "0007_item_units"
    assert mod.revision == "0008_serials"


def test_item_serial_in_metadata():
    from src.core.db import Base

    assert "item_serial" in Base.metadata.tables


def test_item_has_is_serialized():
    from src.models.catalog import Item

    assert "is_serialized" in Item.__table__.columns


def test_serial_status_enum():
    from src.models.catalog import SerialStatus

    assert {s.value for s in SerialStatus} == {"in_stock", "sold"}


def test_item_serial_unique_item_serial():
    from src.models.catalog import ItemSerial

    uniques = {tuple(sorted(c.name for c in con.columns))
               for con in ItemSerial.__table__.constraints
               if con.__class__.__name__ == "UniqueConstraint"}
    assert ("item_id", "serial") in uniques
