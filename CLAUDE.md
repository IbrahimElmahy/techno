# techno Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-06-29

## Active Technologies
- Python 3.12 (running 3.11 in dev) — same as Foundation + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, bcrypt, python-jose — reused (002-sales-inventory)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)`, quantity `DECIMAL(18,3)` (002-sales-inventory)
- Python 3.12 (3.11 dev) — same as 001/002 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (003-after-sales-loyalty)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)`, points `BIGINT` (integer) (003-after-sales-loyalty)
- Python 3.12 (3.11 dev) — same as 001/002/003 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (005-general-ledger)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)` via the shared `MONEY` type (005-general-ledger)
- Python 3.12 (3.11 dev) — same as 001–005 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (006-cost-centers-optional)
- MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)` via shared `MONEY` (006-cost-centers-optional)

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
- 006-cost-centers-optional: Added Python 3.12 (3.11 dev) — same as 001–005 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
- 005-general-ledger: Added Python 3.12 (3.11 dev) — same as 001/002/003 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
- 003-after-sales-loyalty: Added Python 3.12 (3.11 dev) — same as 001/002 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
