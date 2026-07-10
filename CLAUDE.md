# techno Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-07-02

## Active Technologies
- Python 3.12 (running 3.11 in dev) — same as Foundation + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, bcrypt, python-jose — reused (002-sales-inventory)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)`, quantity `DECIMAL(18,3)` (002-sales-inventory)
- Python 3.12 (3.11 dev) — same as 001/002 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (003-after-sales-loyalty)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)`, points `BIGINT` (integer) (003-after-sales-loyalty)
- Python 3.12 (3.11 dev) — same as 001/002/003 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (005-general-ledger)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)` via the shared `MONEY` type (005-general-ledger)
- Python 3.12 (3.11 dev) — same as 001–005 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (006-cost-centers-optional)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)` via shared `MONEY` (006-cost-centers-optional)
- Python 3.12 (3.11 dev) — same as 001–006 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (007-five-sale-price)
- Python 3.12 (3.11 dev) — same as 001–007 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (008-multiple-units-measure)
- MySQL 8 / MariaDB 10.6+; money `MONEY` DECIMAL(18,2); quantity `QTY` DECIMAL(18,3) (008-multiple-units-measure)
- Python 3.12 (3.11 dev) — same as 001–008 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (009-serial-numbers-per)
- MySQL 8 / MariaDB 10.6+; quantity `QTY` DECIMAL(18,3) (009-serial-numbers-per)
- Python 3.12 (3.11 dev) — same as 001–009 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (010-barcodes-per-item)
- Python 3.12 (3.11 dev) — same as 001–010 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (011-stock-min-max)

- Python 3.12 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, passlib[bcrypt], (001-foundation)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

cd src; pytest; ruff check .

## Code Style

Python 3.12: Follow standard conventions

## Recent Changes
- 012-manufacturing-bom: Recipe (BOM) + recipe-driven manufacturing orders (linked consume+produce, derived cost, reverse-once) + integrity-preserving CRUD completion across modules
- 011-stock-min-max: Added Python 3.12 (3.11 dev) — same as 001–010 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
- 010-barcodes-per-item: Added Python 3.12 (3.11 dev) — same as 001–009 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
- 009-serial-numbers-per: Added Python 3.12 (3.11 dev) — same as 001–008 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
