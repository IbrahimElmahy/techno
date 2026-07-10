# 014 — Production Engine (Costing + Routing + Wastage) & Comprehensive Reporting

**Status**: backend implemented (v3); frontend in progress
**Methodology**: Library-First + TDD (client-requested)

## Context

Extends manufacturing (012) and reporting per client request: full product costing (materials +
production resources), inventory routing (pull each item from its own warehouse), wastage tracking,
and a comprehensive reporting suite (production/consumption, inventory, wastage, **stagnant stock**,
sales) with flexible periods and filters. Core logic is isolated in reusable libraries and covered
by tests written first.

## Library-First core (`backend/src/lib`)

- **`lib/production.py`** — pure, framework-free production math: `scale_factor`, `consumed_quantity`,
  `resolve_warehouse` (routing), `line_cost`, `resource_cost`, `unit_cost`. Reused by
  `services/manufacturing_service.py` and `services/wastage_service.py`.
- **`lib/reporting.py`** — one function per report `(session, **params) -> dict`. Period bucketing
  (week/month/year) is done in Python → identical on SQLite and Postgres. Reused by `/reports/*`.

## Functional additions

- **Costing (FR-014-01)**: recipes carry standard **resources** (`bom_resource`: labor/machine/
  overhead/other = quantity × rate per batch). An order seeds resources from the recipe (scaled) and
  the caller may override actuals. `manufacturing_order` stores `material_cost` + `resource_cost`;
  `total_cost = material + resource`; `unit_cost = total / produced`. No ledger entry (money boundary).
- **Routing (FR-014-02)**: `item.default_warehouse_id`. An order pulls each component from its item's
  warehouse and produces the product into the product's warehouse (fallback = the order's location),
  so balances never mix. `manufacturing_order_consumption.warehouse_id` records where each pull came
  from.
- **Wastage (FR-014-03)**: per-order `manufacturing_order_consumption.waste_quantity` **and** a
  standalone reversible `wastage_document` (posts `waste_out`). Both feed the wastage report.

## Reports (`/reports/*`, GET)

`production` (produced vs consumed + cost, bucketed), `inventory` (on-hand + value per item×
warehouse), `wastage` (order waste + documents, valued), `stagnant?days=N` (positive stock with no
OUT movement within N days — slow/dead stock; **the critical report**), `sales` (bucketed totals).
All accept date range + relevant filters (`period`, `warehouse_id`, `item_id`, `product_id`).

## Data model / migration

New tables `bom_resource`, `manufacturing_order_resource`, `wastage_document`; new columns
`item.default_warehouse_id`, `manufacturing_order.material_cost/resource_cost`,
`manufacturing_order_consumption.waste_quantity/warehouse_id`. Migration `0012_production_reporting`.

**Deploy**: startup `_ensure_columns()` in `main.py` adds new columns on existing DBs (create_all
only creates tables), so serverless (Vercel) deploys self-provision the schema.

## Testing (TDD)

`tests/unit/test_production_lib.py`, `tests/integration/test_production_costing.py`,
`test_wastage.py`, `test_reporting.py` — costing (standard + override), routing (pulled from the
right warehouse), wastage (order + document, reverse, no-negative), and report accuracy (esp.
stagnant & wastage). Full backend suite green.

## Out of scope

- Ledger valuation of production cost / WIP (stays off-ledger).
- Machine as a first-class entity (resources are labeled lines, not linked machine records).
