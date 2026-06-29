"""Baseline: all foundation tables + ledger immutability trigger (T016/T026/T034/T040/T047/T056).

Greenfield first migration. Creates the full foundation schema from the model metadata and,
on MySQL/MariaDB, installs triggers that reject UPDATE/DELETE on ledger rows (FR-028). No data
backfill — legacy migration is a separate, table-by-table deployment concern (Principle I).
"""
from __future__ import annotations

from alembic import op

from src.core.db import Base
import src.models  # noqa: F401  (populate metadata)

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

_LEDGER_TABLES = ("ledger_entry", "ledger_line")


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)

    if bind.dialect.name in ("mysql", "mariadb"):
        for table in _LEDGER_TABLES:
            op.execute(
                f"""
                CREATE TRIGGER trg_{table}_no_update BEFORE UPDATE ON {table}
                FOR EACH ROW SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = '{table} is immutable; post a reversal entry instead';
                """
            )
            op.execute(
                f"""
                CREATE TRIGGER trg_{table}_no_delete BEFORE DELETE ON {table}
                FOR EACH ROW SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = '{table} is immutable; post a reversal entry instead';
                """
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name in ("mysql", "mariadb"):
        for table in _LEDGER_TABLES:
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_no_update")
            op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_no_delete")
    Base.metadata.drop_all(bind=bind)
