# Phase 0 Research: Multiple Units of Measure

Two clarifications (price = base × factor; scope = sales + purchases + stock) resolved 2026-06-29.

## R1 — Unit master
`item_unit(item_id FK, name, factor QTY)` unique (item_id, name). The base unit is
`item.unit_of_measure` with an **implicit** factor of 1 (no row). `factor > 0` (a positive decimal, so
0.5-style fractional units are expressible). Managing units reuses `catalog.write`.

## R2 — Factor resolution (`uom_service`)
`resolve_factor(db, item, unit)`:
- `unit` is None or equals `item.unit_of_measure` → `Decimal(1)`.
- else the `item_unit` row's factor for (item, unit).
- else `UomError` (unknown unit).
Pure and deterministic; one lookup per line.

## R3 — Stock conversion (the invariant)
The document line carries the entered quantity **in the chosen unit**; the service converts to base before
calling the unchanged 002 `stock_service.post_movement`: `base_qty = entered_qty × factor`. On-hand and
No-Negative-Stock therefore stay entirely in base units (Principle XI). The line stores `quantity`
(entered), `unit`, and `unit_factor` (snapshot).

## R4 — Pricing interaction (007)
Tier prices are per **base** unit. In `sales_service`, after resolving the base-tier price (007), the
line's **list price** for the chosen unit = `base_tier_price × factor`. The actual price = override or that
value. The 007 below-price check compares `actual < base_tier_price × factor`. Factor 1 (no unit) ⇒
identical to 007 (no regression). `line_total = entered_qty × actual_price`.

## R5 — Returns
`return_sale` / `return_purchase` already aggregate by `item_id` against the line's quantity (same unit).
Extend the `sold`/`purchased` snapshot to carry `unit_factor`: stock reverses by `returned_qty × factor`
base units; money reverses by `returned_qty × unit_price`. Same-unit assumption (one line per item) is the
existing 002 behaviour, retained.

## R6 — Purchases
Symmetric to sales for quantity/stock: `PurchaseLine` gains `unit`; `base_qty = qty × factor`; line stores
unit + factor. Purchase price is per the chosen unit (caller-supplied, as today — no tier on purchases).

## R7 — Migration
`0007_item_units.py` (down-revision `0006_price_tiers`):
1. `create_table('item_unit', ...)` unique (item_id, name), FK item.
2. `ALTER sales_invoice_line ADD unit VARCHAR, ADD unit_factor QTY DEFAULT 1`.
3. `ALTER purchase_invoice_line ADD unit VARCHAR, ADD unit_factor QTY DEFAULT 1`.
No backfill (existing lines: unit NULL, factor effectively 1). SQLite builds from models in tests.
