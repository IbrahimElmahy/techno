"""T030: the 0004 migration is additive and complete (metadata-level; MySQL verified separately)."""
import importlib.util
from pathlib import Path


def _load():
    path = Path(__file__).resolve().parents[1].parent / "migrations" / "versions" / "0004_general_ledger.py"
    spec = importlib.util.spec_from_file_location("mig0004", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_chains_onto_003():
    mod = _load()
    assert mod.down_revision == "0003_after_sales_loyalty"
    assert mod.revision == "0004_general_ledger"


def test_account_enum_includes_new_values():
    from src.models.ledger import AccountType

    values = {a.value for a in AccountType}
    assert "opening_balance_equity" in values
    assert "user_defined" in values


def test_role_enum_includes_accountant():
    from src.models.role import RoleName

    assert "accountant" in {r.value for r in RoleName}


def test_account_has_chart_columns():
    from src.models.ledger import Account

    cols = Account.__table__.columns
    for name in ("parent_id", "code", "name", "nature", "is_postable", "is_system"):
        assert name in cols, f"missing account.{name}"
    assert cols["code"].unique


def test_ledger_line_has_statement_and_entry_has_date():
    from src.models.ledger import LedgerEntry, LedgerLine

    assert "statement" in LedgerLine.__table__.columns
    assert "entry_date" in LedgerEntry.__table__.columns


def test_seed_rehomes_system_accounts(chart, db):
    """After seeding, the singleton system accounts are postable is_system leaves with codes."""
    from src.models.ledger import Account, AccountType

    treasury = db.query(Account).filter(Account.account_type == AccountType.treasury).one()
    assert treasury.is_system and treasury.is_postable
    assert treasury.code == "1.01.001"
    assert treasury.parent_id is not None
