# Phase 0 Research: Stock Min/Max Limits & Expiry Batches

Scope resolved 2026-06-30: both min/max limits AND expiry batches (FEFO).

## R1 — Item columns
`item.min_stock` (QTY nullable), `item.max_stock` (QTY nullable), `item.is_perishable` (bool default
false). All optional; existing items unaffected. Managed via `catalog.write`.

## R2 — Reorder report (`stock_report.reorder`)
For each item with min_stock or max_stock set, compute **total on-hand** = Σ over all locations (from the
002 stock movements). Classify: `below_min` if total < min_stock; `above_max` if total > max_stock; else
excluded. Read-only aggregate; advisory (never blocks). Uses `stock.read`.

## R3 — Batch model
`stock_batch(item_id FK, location_kind, location_id, expiry_date Date, quantity QTY remaining)`. A lot at
a location with a shared expiry. Rows with quantity 0 are kept (or filtered on read). Multiple batches per
(item, location) with different expiries are the norm; a receive/return may aggregate into an existing
(item, location, expiry) row or create a new one — we **aggregate by (item, location, expiry)** to keep
rows tidy.

## R4 — Batch receive (`batch_service.receive`)
For a perishable item: upsert the (item, location, expiry) batch (+quantity) and post **one stock-in** of
that quantity via the unchanged 002 `stock_service.post_movement` (movement_type "batch_receive_in").
Non-perishable → error. Keeps on-hand == batch sum (FR-007). Uses `purchase.write`.

## R5 — FEFO consume on sale (`batch_service.consume_fefo`)
`SaleLine` for a perishable item: validate **base unit** (factor 1) — else error. Then consume `quantity`
from the item's batches at the origin, **ordered by (expiry_date, id)**; decrement each until satisfied;
if the batches don't cover it, raise (No-Negative-Stock — the batch sum equals on-hand, so this coincides
with the 002 guard). The existing 002 stock-out still posts the quantity. Order in `create_sale`: validate
base unit first, then the stock-out (which enforces no-negative), then FEFO-decrement the batches (both in
the same transaction; a shortfall in either rolls back).

## R6 — Return restore (`batch_service.restore_for_return`)
A perishable return line carries an `expiry_date`. Upsert the (item, origin-location, expiry) batch
(+quantity); the existing 002 stock-in posts. A missing expiry for a perishable item → error.

## R7 — Expiring report (`batch_service.expiring`)
`GET /stock/expiring?before=DATE` → batches with `expiry_date ≤ DATE` and quantity > 0, ordered by
expiry. Optional item filter. Read-only, `stock.read`.

## R8 — RBAC
No new capability: min/max/is_perishable via `catalog.write`; batch receive via `purchase.write`; reorder
+ expiring + batch list via `stock.read`; sale/return via `sale.write` / `return.write` (all existing).

## R9 — Migration
`0010_limits_batches.py` (down-revision `0009_barcodes`):
1. `ALTER item ADD min_stock QTY NULL, ADD max_stock QTY NULL, ADD is_perishable BOOL DEFAULT 0`.
2. `create_table('stock_batch', ...)` FK item, index (item_id, location_kind, location_id, expiry_date).
No backfill. SQLite builds from models in tests.
