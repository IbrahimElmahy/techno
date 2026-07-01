# Implementation Plan: Stock Min/Max Limits & Expiry Batches

**Branch**: `011-stock-min-max` | **Date**: 2026-06-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/011-stock-min-max/spec.md`
**Builds on**: Sales & Inventory (`002`) + Multiple Units (`008`). Fifth (final planned) sub-feature of the
A5Group Item-card track (S06 — after pricing, units, serials, barcode).

## Summary

Two related capabilities, both additive. **(A) Min/max limits**: `item.min_stock` / `item.max_stock`
(advisory, base units) + a **reorder report** listing items below min / above max by total on-hand.
**(B) Expiry batches**: `item.is_perishable` + a new `stock_batch(item, location, expiry_date, quantity)`
table; a **batch receive** operation registers a batch and posts a stock-in through the unchanged 002
stock service; selling a perishable item consumes batches **FEFO** (earliest expiry first) in the base
unit; a return restores quantity to a batch at the returned expiry; an **expiring-soon report** lists
batches at/before a cutoff. The invariant — batch-quantity sum at a location equals on-hand — is kept by
pairing every batch change with a 002 quantity movement. A new `batch_service` owns the batch/FEFO logic;
a small `stock_report` helper computes reorder. Money/ledger and all 002/007/008/009 flows are unchanged.
Built test-first (Principle X) for reorder classification, batch receive, FEFO consumption, the base-unit
guard, and the return restore + expiring report.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001–010
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+; quantity `QTY` DECIMAL(18,3)
**Testing**: pytest, httpx ASGI client; SQLite in-memory; MySQL for migration check
**Target Platform**: Linux server; Electron+React back-office client
**Project Type**: Web service — additive modules under `backend/`
**Performance Goals**: FEFO scans a few batches per line; reorder/expiring are simple aggregates
**Constraints**: limits advisory (never block); batch sum == on-hand; base unit only; money/ledger
unchanged; reuse existing capabilities; no new role
**Scale/Scope**: batches per perishable item modest; item flags/limits additive

## Constitution Check

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New limits/batches from spec; A5Group feature, no legacy code/data. ✅ |
| II | Single Source of Truth | OpenAPI extended additively; drift-gated. ✅ |
| III | Offline-First Mobile | Sale path shared; new fields additive & optional. ✅ |
| IV | Reversibility | Returns restore batches; stock movements immutable & reverse-once (002). ✅ |
| V | Multi-Branch & Warehouse | Batches carry a location; reorder is item-total. ✅ |
| VI | Treasury & Customer Accounts | Money/ledger untouched; limits/batches are planning + rotation. ✅ |
| VII | RBAC | Reuses catalog.write / purchase.write / stock.read; no new role. ✅ |
| VIII | Arabic RTL / EGP | Unaffected; dates/quantities are data. ✅ |
| IX | Reporting first-class | Reorder + expiring reports derived from the source of truth. ✅ |
| X | Test-First | Reorder, batch receive, FEFO, base-unit, return/expiring get failing tests first. ✅ |
| XI | No Negative Stock | Every batch move posts a 002 quantity movement; on-hand authoritative. ✅ |

**Gate result: PASS.** Decisions in Complexity Tracking (justified).

## Project Structure

```text
backend/src/
├── models/
│   ├── catalog.py        # EXTEND Item: +min_stock, +max_stock, +is_perishable
│   └── stock.py          # NEW StockBatch(item_id, location_kind/id, expiry_date, quantity)
├── services/
│   ├── batch_service.py       # NEW: receive(), consume_fefo(), restore_for_return(), expiring(), assert_base_unit()
│   ├── stock_report.py        # NEW: reorder() (below_min / above_max by total on-hand)
│   └── sales_service.py       # EXTEND: perishable line → FEFO consume (post stock-out); return → restore batch
├── api/
│   ├── catalog.py        # EXTEND: min/max + is_perishable on item; batch receive + list; expiring
│   ├── stock.py          # EXTEND: GET /stock/reorder
│   └── sales.py          # EXTEND ReturnLineIn (+expiry_date for perishable)
├── migrations/versions/
│   └── 0010_limits_batches.py # additive: item.min/max/is_perishable; stock_batch table
└── tests/
    ├── unit/   (test_reorder_report, test_batch_fefo, test_batch_return)
    ├── integration/ (test_batches_api, test_perishable_sale_flow)
    └── contract/ (test_limits_batches_contract)
```

**Structure Decision**: Additive only — three item columns, a new `stock_batch` table, a new
`batch_service` + `stock_report`, and small extensions to `sales_service` and the catalog/stock/sales
routers. Migration `0010_limits_batches` chains on `0009_barcodes`. The 002 stock service is untouched
(batch paths call it with the batch quantity). Non-perishable items and all 002–010 behaviour unchanged.

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| A **stock_batch table** (item, location, expiry, remaining) | FEFO must pick the earliest-expiry lot and deplete it; the expiring report needs remaining-by-expiry; the immutable stock movements stay the quantity audit trail | A movement-only expiry log replays every movement to know a lot's remaining for each sale — O(history) per line |
| **Batch receive posts a stock-in** (qty = batch quantity) | Keeps on-hand == batch sum (FR-007) without a second quantity store; reuses No-Negative-Stock | A pure batch registry diverges on-hand from batch sum and breaks the negative-stock guard |
| Perishable lines **base unit only** | FEFO quantity is in base units; mixing 008 factors would need per-batch factor bookkeeping | Combining alternate units with batches is deferred (out of scope) |
| **Min/max advisory** (never block) + reorder report | Limits are planning signals; blocking sales on them contradicts No-Negative-Stock being the only stock gate | Enforcing min as a hard floor would reject legitimate sales and duplicate the negative-stock rule |
| Return restores to a **caller-provided expiry** batch | The per-line original batch isn't tracked; an expiry keeps the batch-sum = on-hand invariant | Guessing the batch loses the expiry; a full sale→batch consumption ledger is a larger feature |
