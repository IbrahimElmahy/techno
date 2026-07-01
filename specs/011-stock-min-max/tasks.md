---
description: "Task list for Stock Min/Max Limits & Expiry Batches — additive to 002/008"
---

# Tasks: Stock Min/Max Limits & Expiry Batches

**Input**: Design documents from `/specs/011-stock-min-max/`
**Builds on**: Sales & Inventory (`002`) + Multiple Units (`008`). **Stock service untouched** — batch
paths call it with the batch quantity. Non-perishable items + all 002–010 behaviour unchanged.

**Tests**: REQUIRED. Principle X — test-first for: **reorder classification**, **batch receive**, **FEFO
consumption + base-unit guard**, and **return restore + expiring report**. Each gets a failing [test]
before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` · `[US#]` · cites FR(s). Path base: `backend/`.

---

## Phase 1: Setup — Model & Services

- [x] T001 [impl] Extend `src/models/catalog.py` `Item`: +`min_stock` (QTY nullable), +`max_stock` (QTY nullable), +`is_perishable` (Boolean default False) — data-model; research R1
- [x] T002 [impl] `src/models/stock.py`: `StockBatch` (item_id FK indexed, location_kind Enum, location_id, expiry_date Date, quantity QTY) + index (item,location,expiry) — data-model; research R3
- [x] T003 [impl] `src/models/__init__.py`: register `StockBatch`
- [x] T004 [impl] `src/services/batch_service.py`: `receive()`, `assert_base_unit()`, `consume_fefo()`, `restore_for_return()`, `expiring()` — research R4/R5/R6/R7
- [x] T005 [impl] `src/services/stock_report.py`: `reorder(db)` (below_min/above_max by total on-hand) — research R2
- [x] T006 [impl] Extend `tests/conftest.py`: a perishable-product factory + a batch-receive helper

**Checkpoint**: model + services exist.

---

## Phase 2: Min/Max + Reorder — [US1] 🎯

### Tests first (Principle X)
- [x] T007 [P] [test] [US1] `tests/unit/test_reorder_report.py`: below_min when on-hand < min; above_max when > max; in-range excluded; setting a limit never blocks a sale — FR-001/002; SC-001

### Implementation (make T007 green)
- [x] T008 [impl] [US1] `src/services/stock_report.py` `reorder`; `src/api/stock.py` `GET /stock/reorder` (stock.read); `min_stock`/`max_stock` on item create/update/out — FR-001/002; contracts
- [x] T009 [P] [test] [US1] `tests/integration/test_batches_api.py::reorder` part — set limits via API; reorder lists below/above — US1

**Checkpoint**: T007 green; reorder report works; limits advisory.

---

## Phase 3: Batch Receive + Expiring — [US2][US4]

- [x] T010 [impl] [US2] `src/services/batch_service.py` `receive` (perishable only; upsert batch; `stock_service.post_movement(in)`); `src/api/catalog.py` `POST /items/{id}/batches/receive` (purchase.write), `GET /items/{id}/batches` (stock.read), `is_perishable` on item — FR-003/004; contracts
- [x] T011 [impl] [US4] `src/services/batch_service.py` `expiring`; `src/api/stock.py` `GET /stock/expiring?before=` (stock.read) — FR-008; contracts
- [x] T012 [P] [test] [US2][US4] `tests/integration/test_batches_api.py`: mark perishable; receive 2 batches → on-hand + list; non-perishable receive → 422; expiring ≤ cutoff earliest-first; RBAC (non-purchase receive → 403) — US2/US4; FR-003/004/008

**Checkpoint**: batches enter stock; expiring report works.

---

## Phase 4: FEFO Sale + Return — [US3][US4] 🎯

### Tests first (Principle X)
- [x] T013 [P] [test] [US3] `tests/unit/test_batch_fefo.py`: batches 5@early + 10@late; sell 7 → early emptied + 2 from late; on-hand 8; alternate unit rejected; shortfall rejected; batch sum == on-hand — FR-005/007; SC-003/004
- [x] T014 [P] [test] [US4] `tests/unit/test_batch_return.py`: return N@expiry → batch(expiry) += N + on-hand +N; missing expiry rejected — FR-006; SC-004

### Implementation (make T013–T014 green)
- [x] T015 [impl] [US3] Extend `src/services/sales_service.py` `create_sale`: for a perishable item, `batch_service.assert_base_unit` (pre) then stock-out (002) then `consume_fefo` — FR-005; research R5
- [x] T016 [impl] [US4] Extend `src/services/sales_service.py` `return_sale`: `ReturnLine` +`expiry_date`; for a perishable item `batch_service.restore_for_return` (after stock-in); missing expiry → error — FR-006; research R6
- [x] T017 [impl] [US4] Extend `src/api/sales.py`: `ReturnLineIn` +`expiry_date` (pass through) — contracts; FR-006
- [x] T018 [P] [test] [US3][US4] `tests/integration/test_perishable_sale_flow.py`: receive 2 batches → sell FEFO → return → batch sum == on-hand throughout — US3/US4; SC-004/006

**Checkpoint**: T013–T014 green; perishable sales rotate FEFO; returns restore batches.

---

## Phase 5: Migration, Contract & Polish

- [x] T019 [impl] Alembic `0010_limits_batches` (down_revision `0009_barcodes`): `ALTER item ADD min_stock/max_stock/is_perishable`; create `stock_batch` (FK item, index); additive, no backfill — research R9
- [x] T020 [P] [test] `tests/integration/test_migration_additive_011.py`: down_revision `0009_barcodes`; `stock_batch` in metadata; `item` has min_stock/max_stock/is_perishable
- [x] T021 [impl] Extend `scripts/check_contract_drift.py` with the 011 contract; the 001–010 gate stays green
- [x] T022 [P] [test] `tests/contract/test_limits_batches_contract.py`: `/items/{id}/batches` GET + `/batches/receive` POST + `/stock/reorder` + `/stock/expiring` present; item schema exposes min/max/is_perishable

---

## Phase 6: Frontend (Desktop, Arabic RTL)

- [x] T023 [impl] `frontend/src/pages/Catalog.tsx`: min/max + is_perishable on item create/edit; a **«الدفعات/الصلاحية»** action (receive batch + list) for perishable items
- [x] T024 [impl] `frontend/src/pages/Reports.tsx` (or a new view): **reorder** + **expiring** reports
- [x] T025 [P] [impl] `tsc --noEmit` clean; perishable returns capture `expiry_date`

---

## Dependencies & Execution Order

Phase order: Setup (P1) → **Reorder (P2)** → Batch receive + expiring (P3) → **FEFO sale + return (P4)** →
Migration/Contract (P5) → Frontend (P6).

### Test-before-impl pairings
- T007 before T008; T013/T014 before T015/T016; T012 with T010/T011.

### Key edges
- T001/T002 → everything. T004 (batch_service) → sales integration (T015/T016). T010 (receive) → flow tests.

### Notes
- Additive only: three item columns + one table; stock service untouched (called with batch quantity).
- Batch sum == on-hand for perishable items; base unit only; limits advisory; money/ledger unchanged.
- Reuse existing capabilities; no new role. Serial+batch on same item deferred.
