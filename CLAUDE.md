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

## Legacy databases are READ-ONLY

The client's two legacy systems live on SQL Server and are **still in daily use**:

| قاعدة | فيها إيه |
|---|---|
| `aliaa2026` · `Techno2026` | a5 — المبيعات والمخازن والحسابات (فرعَي العلياء وأكتوبر) |
| `ERP` | ⛔ **ممنوعة تماماً** — مش مصدر، اقرا تحت |

### ⛔ قاعدة `ERP` ممنوع لمسها ولا قراءتها

**مش قراءة-فقط زي التانيتين — دي ممنوعة خالص.** مافيش `SELECT` ولا تصدير ولا حتى
فحص أعمدة. متفتحش عليها اتصال أصلاً.

**مصدر داتا ما بعد البيع هو ملف العميل الإكسل وحده** — الصفحات المسمّاة فيه:
سباك، اضافه تجار، عملاء، نقاط، كوبونات، مندوب، معاينات، قطع، A5. والصفحات
المرقّمة (`0`/`1`/`2`) **مش بتاعتنا** كمان.

ليه: النقل الأصلي قرا من `ERP` مباشرةً فطلعت داتا مالهاش أصل عند العميل — ٢٬٠٢٧
كارت سباك بينما شيت العميل فيه ١٬٧٢٧، و٣١٩ كارت مالهمش صف في الشيت، و٨٨ كارت
`ERP-M`/`ERP-D` مش موجودين في ولا صفحة. والجسر اللي اتبنى من الصفحات المرقّمة
أدّى لدمج غلط.

والملف نفسه فيه الجسر لـa5 مكتوب بإيد العميل: «كود تاجر A5» في الكوبونات
(١٩٬٦٣٥ صف)، «كود تاجر» في المعاينات (١٠٬٧٢٦)، «كود A5» في صفحة سباك (٤١).
وحتى مع مفتاح من الملف، اتأكد إن الاسمين على طرفَي المفتاح متسقين قبل أي دمج.

**`SELECT` and export only.** No `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `CREATE` —
not even a temp table or a "quick fix". Every write goes to **our own Postgres** on the
server (`DATABASE_URL` in `backend/.env`); that is the project we own.

Two reasons, and either one is enough: the client is working in those systems right now and
we hold no backup to restore from, and they are the reference we check the migration
against — a source we edited proves nothing.

Need to correct migrated data? Correct it in our Postgres with a script under
`backend/src/scripts/`, never at the source.

## Recent Changes
- 011-stock-min-max (built): advisory min/max thresholds + reorder report (how much to buy); perishable items tracked in expiry lots with FEFO consumption on sale, lot restore on return, and an expiring-soon report. Invariant: batch sum == derived on-hand at every location.
- 030-invoice-parity: Warehouse moved from the document to the LINE (one invoice can be served out of several warehouses; availability checked on the SUM per item×warehouse; reversal returns each line to its own warehouse). Cost of goods frozen on each sold line (`costing_service.average_cost`) so past profit never moves. Document fields: rep, posting account (drives the ledger), external document number, notes + 3 statements. Party picker modal with inline create. Migration `0028` backfills legacy lines from their document.
- 029-a5web-parity: Feature-gap research vs. the client's current a5system (see `specs/029-a5web-parity/research.md`)
- 014-production-reporting: Costing engine (recipe resources labor/machine + per-order override), inventory routing (per-item default warehouse), wastage (order + document), comprehensive reports (production/inventory/wastage/stagnant/sales). Library-First (`src/lib/production.py`, `src/lib/reporting.py`) + TDD
- 013-settings-lookups: Admin-configurable dropdown lists (system enum-bound relabel/reorder/hide; custom free add/edit/remove)
- 012-manufacturing-bom: Recipe (BOM) + recipe-driven manufacturing orders (linked consume+produce, derived cost, reverse-once) + integrity-preserving CRUD completion across modules
- 011-stock-min-max: Added Python 3.12 (3.11 dev) — same as 001–010 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
- 010-barcodes-per-item: Added Python 3.12 (3.11 dev) — same as 001–009 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
- 009-serial-numbers-per: Added Python 3.12 (3.11 dev) — same as 001–008 + FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
