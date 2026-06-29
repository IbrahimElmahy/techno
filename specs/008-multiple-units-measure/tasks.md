---
description: "Task list for Multiple Units of Measure — additive to 002/007"
---

# Tasks: Multiple Units of Measure

**Input**: Design documents from `/specs/008-multiple-units-measure/`
**Builds on**: Sales & Inventory (`002`) + Price Tiers (`007`). **No ledger/stock-service change** — the
stock service is called with the converted base quantity. Base unit kept (factor 1) ⇒ no 002/007 regression.

**Tests**: REQUIRED. Principle X — test-first for the three critical paths: **factor resolution**,
**base-unit stock conversion** (qty × factor; on-hand/No-Negative in base), and **price = base-tier ×
factor** (incl. the 007 below-price check). Each gets a failing [test] before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` · `[US#]` user story · cites FR(s). Path base: `backend/`.

---

## Phase 1: Setup — Model & Service

- [X] T001 [impl] Extend `src/models/catalog.py`: `ItemUnit` (item_id FK indexed, name String(16), factor QTY, UNIQUE(item_id,name)) — data-model §item_unit; research R1
- [X] T002 [impl] `src/models/__init__.py`: register `ItemUnit`
- [X] T003 [impl] Extend `src/models/sales.py` `SalesInvoiceLine`: +`unit` (String(16) nullable), +`unit_factor` (QTY default 1) — FR-003; data-model
- [X] T004 [impl] Extend `src/models/purchasing.py` `PurchaseInvoiceLine`: +`unit`, +`unit_factor` — FR-003; data-model
- [X] T005 [impl] `src/services/uom_service.py`: `resolve_factor(db, item, unit)` (base/None→1; alt row; else `UomError`) — FR-001; research R2
- [X] T006 [impl] Extend `tests/conftest.py`: a `make_unit(db, item, name, factor)` helper + reuse `make_priced_product` — reused by all phases

**Checkpoint**: unit model + columns + resolver exist.

---

## Phase 2: Resolver + Stock Conversion — [US1][US3] 🎯

### Tests first (Principle X)
- [X] T007 [P] [test] [US1] `tests/unit/test_uom_resolution.py`: base/None → 1; alternate → its factor; unknown → `UomError`; factor > 0 — FR-001; SC-001
- [X] T008 [P] [test] [US3] `tests/unit/test_unit_stock_conversion.py`: selling 2 of a factor-12 unit posts 24 base out; on-hand is base; No-Negative computed in base — FR-004; SC-002/003

### Implementation (make T007–T008 green)
- [X] T009 [impl] [US2][US3] Extend `src/services/sales_service.py`: `SaleLine` +`unit`; per line `factor=uom_service.resolve_factor`; `base_qty=qty×factor` → `stock_service.post_movement`; `list_price=tier_price×factor`; `unit_price=override or list`; below-price check vs `list`; record `unit`/`unit_factor`; returns reverse `qty×factor` stock + `qty×unit_price` money — FR-003/004/005/006/007; research R4/R5
- [X] T010 [impl] [US2] Extend `src/services/purchase_service.py`: `PurchaseLine` +`unit`; `base_qty=qty×factor` → stock; record `unit`/`unit_factor`; returns reverse `qty×factor` stock + `qty×unit_price` money — FR-003/004/006; research R6

**Checkpoint**: T007–T008 green; quantity converts to base everywhere; price scales by factor.

---

## Phase 3: Item Units API + Pricing factor test — [US1][US2]

- [X] T011 [impl] [US1] `src/api/catalog.py`: `GET /items/{id}/units` (base + alternates) and `PUT /items/{id}/units` (replace alternates; unique name vs base+others; factor > 0; `catalog.write`) — contracts; FR-001/008
- [X] T012 [P] [test] [US1] `tests/integration/test_item_units_api.py`: set/read units; duplicate name (incl. base) rejected (422); factor ≤ 0 rejected; non-catalog role denied (403) — US1; FR-001/008
- [X] T013 [P] [test] [US2] `tests/unit/test_unit_price_factor.py`: a tiered line in a factor-F unit defaults to base-tier × F; an explicit price overrides; below base×F rejected without `sell.below_price`, allowed with — FR-005; SC-004

**Checkpoint**: units are manageable; the price × factor + below-price interaction holds.

---

## Phase 4: Sales/Purchase API + Returns — [US2]

- [X] T014 [impl] [US2] Extend `src/api/sales.py`: `SaleLineIn` +`unit`; invoice line out +`unit`/`unit_factor` — contracts; FR-003
- [X] T015 [impl] [US2] Extend `src/api/purchases.py`: `PurchaseLineIn` +`unit`; invoice line out +`unit`/`unit_factor` — contracts; FR-003
- [X] T016 [P] [test] [US2] `tests/integration/test_sale_purchase_units.py`: sell/buy in a unit via API → stock moves by qty × factor base; line records unit/factor; no-unit line == 002 — US2; SC-002/005
- [X] T017 [P] [test] [US2] `tests/integration/test_unit_return.py`: returning N of a unit line reverses N × factor base stock and N × unit_price money — FR-006; SC-002

**Checkpoint**: documents transact in units end-to-end; returns honour the snapshot.

---

## Phase 5: Migration, Contract & Polish

- [X] T018 [impl] Alembic `0007_item_units` (down_revision `0006_price_tiers`): create `item_unit` (unique item+name, FK item); `ALTER sales_invoice_line` + `ALTER purchase_invoice_line` add `unit`/`unit_factor`; additive, no backfill — research R7
- [X] T019 [P] [test] `tests/integration/test_migration_additive_008.py`: down_revision `0006_price_tiers`; `item_unit` in metadata; both line tables have `unit`/`unit_factor`; unique (item_id,name)
- [X] T020 [impl] Extend `scripts/check_contract_drift.py` with the 008 contract; the 001–007 gate stays green
- [X] T021 [P] [test] `tests/contract/test_units_contract.py`: `/items/{id}/units` GET/PUT present; sale & purchase line schemas expose `unit`; line outputs expose `unit`/`unit_factor`

---

## Phase 6: Frontend (Desktop, Arabic RTL)

- [X] T022 [impl] `frontend/src/pages/Catalog.tsx`: an item **«الوحدات»** editor (alternate units + factor)
- [X] T023 [impl] `frontend/src/pages/Invoices.tsx`: sale line gains a **unit** select (loads item units; price follows base×factor)
- [X] T024 [impl] `frontend/src/pages/Purchases.tsx`: purchase line gains a **unit** select
- [X] T025 [P] [impl] `tsc --noEmit` clean; load units from `/api/v1/items/{id}/units`

---

## Dependencies & Execution Order

Phase order: Setup (P1) → **Resolver+Stock (P2)** → Units API + price test (P3) → Sales/Purchase API +
returns (P4) → Migration/Contract (P5) → Frontend (P6).

### Test-before-impl pairings
- T007/T008 before T009/T010; T013 before relying on T009 pricing; T012 before/with T011.

### Key edges
- T001/T003/T004 → everything. T005 (resolver) → T009/T010. T011 → frontend.

### Notes
- Additive only: one table + two columns on each line table; base unit kept (factor 1).
- Stock always base; money/ledger unchanged; reuse catalog.write + 007 sell.below_price.
