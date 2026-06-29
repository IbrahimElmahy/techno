# Implementation Plan: Multiple Units of Measure

**Branch**: `008-multiple-units-measure` | **Date**: 2026-06-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-multiple-units-measure/spec.md`
**Builds on**: Sales & Inventory (`002`) + Price Tiers (`007`). Second sub-feature of the A5Group
Item-card track (S06 — after pricing).

## Summary

Add **alternate units of measure** with a conversion factor per item. `item.unit_of_measure` is the base
unit (factor 1); a new `item_unit(item_id, name, factor)` table holds alternates. Sales and purchase
lines may specify a **unit**; the entered quantity is in that unit; the line snapshots `unit` + the
`unit_factor`; and **stock always posts the base quantity** (qty × factor) through the unchanged 002 stock
service (on-hand and No-Negative-Stock stay in base units). The default unit price = the resolved 007
base-tier price × factor (overridable; the below-price capability check uses base × factor). Returns
reverse stock by `qty × line.factor` and money by `qty × line.unit_price` from the line snapshot. Money/
ledger behaviour is unchanged. A new `uom_service` resolves units → factor. Built test-first (Principle X)
for the conversion, the base-unit stock invariant, and the price × factor default.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001–007
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+; money `MONEY` DECIMAL(18,2); quantity `QTY` DECIMAL(18,3)
**Testing**: pytest, httpx ASGI client; SQLite in-memory for unit/integration, MySQL for migration check
**Target Platform**: Linux server; Electron+React back-office client
**Project Type**: Web service — additive modules under `backend/`
**Performance Goals**: one factor lookup per line; sale/purchase latency unchanged
**Constraints**: stock in base units only; money/ledger unchanged; factor > 0; snapshot on the line; reuse
catalog.write; base unit kept (factor 1) ⇒ no 002/007 regression
**Scale/Scope**: a few units per item; no new ledger, no new capability

## Constitution Check

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New units from spec; A5Group feature, no legacy code/data. ✅ |
| II | Single Source of Truth | OpenAPI extended additively; drift-gated. ✅ |
| III | Offline-First Mobile | Sale path shared; unit fields additive & optional. ✅ |
| IV | Reversibility | Returns reverse via the line snapshot; ledger unchanged. ✅ |
| V | Multi-Branch & Warehouse | Orthogonal to location; unchanged. ✅ |
| VI | Treasury & Customer Accounts | Money/ledger model untouched; units convert qty/scale price. ✅ |
| VII | RBAC | Reuses catalog.write; no new role. ✅ |
| VIII | Arabic RTL / EGP | Unaffected; unit names are labels. ✅ |
| IX | Reporting first-class | Line records unit + factor for analysis. ✅ |
| X | Test-First | Conversion, base-unit stock, price×factor get failing tests first. ✅ |
| XI | No Negative Stock | On-hand + guard in base units (post qty × factor). ✅ |

**Gate result: PASS.** Decisions in Complexity Tracking (justified).

## Project Structure

```text
backend/src/
├── models/
│   ├── catalog.py        # NEW ItemUnit(item_id, name, factor)
│   ├── sales.py          # EXTEND SalesInvoiceLine: +unit, +unit_factor
│   └── purchasing.py     # EXTEND PurchaseInvoiceLine: +unit, +unit_factor
├── services/
│   ├── uom_service.py         # NEW: resolve_factor(db, item, unit) → Decimal (base=1; alt=row; else error)
│   ├── sales_service.py       # EXTEND SaleLine (+unit); base qty = qty×factor; price = base-tier×factor; snapshot
│   └── purchase_service.py    # EXTEND PurchaseLine (+unit); base qty = qty×factor; snapshot; returns use factor
├── api/
│   ├── catalog.py        # EXTEND: GET/PUT /items/{id}/units
│   ├── sales.py          # EXTEND SaleLineIn (+unit); line out (+unit, +unit_factor)
│   └── purchases.py      # EXTEND PurchaseLineIn (+unit); line out (+unit, +unit_factor)
├── migrations/versions/
│   └── 0007_item_units.py     # additive: item_unit table; unit/unit_factor on sales & purchase lines
└── tests/
    ├── unit/   (test_uom_resolution, test_unit_stock_conversion, test_unit_price_factor)
    ├── integration/ (test_item_units_api, test_sale_purchase_units, test_unit_return)
    └── contract/ (test_units_contract)
```

**Structure Decision**: Additive only — a new `item_unit` table, two nullable columns on each of the
sales/purchase line tables, a new `uom_service`, and small sales/purchase service + router extensions.
Migration `0007_item_units` chains on `0006_price_tiers`. The base `unit_of_measure` (factor 1) keeps
002/007 behaviour; the stock service is untouched (callers pass the converted base quantity).

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Alternate units in a **separate `item_unit` table** | A5Group items carry several units with factors; a keyed row keeps the item lean and lets the base stay implicit | Columns-on-item caps the unit count and bloats the item; a JSON blob isn't queryable/validatable |
| **Stock always in the base unit** (convert at the document boundary) | Mixing units in stock would corrupt on-hand and No-Negative-Stock (XI); base is the single quantity truth | A per-unit stock balance multiplies rows and needs cross-unit reconciliation for every report and the negative-stock guard |
| **Price = base-tier × factor** (derived, not stored per unit) | Clarified; keeps 007 tiers per base unit and avoids a 5×units price matrix | Per-unit price tables explode the pricing data and contradict the 007 model |
| Snapshot **unit + factor on the line** | Returns and reports must use the factor as transacted, even if the item's units later change | Re-reading the item's units at return time breaks when a factor was edited or a unit removed |
