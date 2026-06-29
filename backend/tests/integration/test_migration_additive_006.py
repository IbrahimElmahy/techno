"""T018: the 0005 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0005_cost_centers.py"
    spec = importlib.util.spec_from_file_location("mig0005", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_005():
    mod = _load()
    assert mod.down_revision == "0004_general_ledger"
    assert mod.revision == "0005_cost_centers"


def test_cost_center_table_in_metadata():
    from src.core.db import Base

    assert "cost_center" in Base.metadata.tables


def test_ledger_line_has_cost_center_id():
    from src.models.ledger import LedgerLine

    assert "cost_center_id" in LedgerLine.__table__.columns


def test_cost_center_code_unique():
    from src.models.cost_center import CostCenter

    assert CostCenter.__table__.columns["code"].unique
