---
description: "Task list for Serial Numbers per Item — additive to 002/008"
---

# Tasks: Serial Numbers per Item

**Input**: Design documents from `/specs/009-serial-numbers-per/`
**Builds on**: Sales & Inventory (`002`) + Multiple Units (`008`). **Stock service untouched** — serial
paths call it with quantity = serial count. Non-serialized items + all 002/007/008 behaviour unchanged.

**Tests**: REQUIRED. Principle X — test-first for: **receive** (new-per-item, +N stock, in_stock@loc),
**sale guards** (count==qty, base unit, in_stock@origin, serialized↔serials), and **return restore**
(sold-on-this-invoice → in_stock). Each gets a failing [test] before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` · `[US#]` · cites FR(s). Path base: `backend/`.

---

## Phase 1: Setup — Model & Service

- [X] T001 [impl] Extend `src/models/catalog.py`: `Item.is_serialized` (Boolean default False); `SerialStatus` enum (in_stock|sold); `ItemSerial` (item_id FK indexed, serial String(64), status, location_kind/id nullable, sold_invoice_id FK nullable, UNIQUE(item_id,serial)) — data-model; research R1
- [X] T002 [impl] `src/models/__init__.py`: register `ItemSerial`
- [X] T003 [impl] `src/services/serial_service.py`: `receive()`, `mark_sold()`, `restore_for_return()`, `assert_sale_serials()` — research R2/R3/R4
- [X] T004 [impl] Extend `tests/conftest.py`: a serialized-product factory + helper to receive serials — reused by all phases

**Checkpoint**: serial model + service exist.

---

## Phase 2: Receive — [US1] 🎯

### Tests first (Principle X)
- [X] T005 [P] [test] [US1] `tests/unit/test_serial_receive.py`: N new serials → in_stock@loc + on-hand +N; duplicate-for-item rejected; non-serialized item rejected — FR-002/003; SC-001/004

### Implementation (make T005 green)
- [X] T006 [impl] [US1] `src/services/serial_service.py` `receive(db, item, location_kind, location_id, serials, actor)`: reject non-serialized / duplicate; create in_stock rows; `stock_service.post_movement(in, qty=len)` — FR-003; research R2
- [X] T007 [impl] [US1] `src/api/catalog.py`: `POST /items/{id}/serials/receive` (purchase.write) and `GET /items/{id}/serials` (stock.read, status/location filter); `is_serialized` on item create/update/out — contracts; FR-001/002/003
- [X] T008 [P] [test] [US1] `tests/integration/test_serials_api.py`: mark serialized; receive; list in_stock; duplicate/non-serialized → 422; RBAC (non-purchase role receive → 403) — US1; FR-001/003

**Checkpoint**: T005 green; serials enter stock and on-hand tracks the count.

---

## Phase 3: Sell — [US2] 🎯

### Tests first (Principle X)
- [X] T009 [P] [test] [US2] `tests/unit/test_serial_sale_guards.py`: serialized sale requires count==qty + base unit + in_stock@origin → serials sold + on-hand −N; non-serialized line with serials rejected; serialized line without serials rejected; serial not at origin / already sold rejected; alternate unit rejected — FR-004; SC-002/004

### Implementation (make T009 green)
- [X] T010 [impl] [US2] Extend `src/services/sales_service.py`: `SaleLine` +`serials`; for serialized items call `serial_service.assert_sale_serials` (pre) then `mark_sold` (post stock-out); non-serialized + serials → error — FR-004; research R3
- [X] T011 [impl] [US2] Extend `src/api/sales.py`: `SaleLineIn` +`serials` — contracts; FR-004
- [X] T012 [P] [test] [US2] `tests/integration/test_serial_sale_flow.py`: receive 3 → sell 2 (serials) → 1 in_stock + on-hand 1; in-stock serial count == on-hand throughout — US2; SC-004/005

**Checkpoint**: T009 green; serialized sales consume specific serials with the guards.

---

## Phase 4: Return — [US3]

### Tests first (Principle X)
- [X] T013 [P] [test] [US3] `tests/unit/test_serial_return.py`: returning a sold-on-this-invoice serial → in_stock@origin + on-hand +1; a serial not sold on the invoice rejected; count ≠ qty rejected — FR-005; SC-003

### Implementation (make T013 green)
- [X] T014 [impl] [US3] Extend `src/services/sales_service.py` `return_sale`: accept per-line `serials`; for serialized items `serial_service.restore_for_return` (post stock-in); count == returned qty — FR-005; research R4
- [X] T015 [impl] [US3] Extend `src/api/sales.py`: `ReturnLineIn` +`serials` (pass through) — contracts; FR-005

**Checkpoint**: T013 green; returns restore invoice-sold serials.

---

## Phase 5: Migration, Contract & Polish

- [X] T016 [impl] Alembic `0008_serials` (down_revision `0007_item_units`): `ALTER item ADD is_serialized`; create `item_serial` (unique item+serial, FK item, sold_invoice_id FK); additive, no backfill — research R7
- [X] T017 [P] [test] `tests/integration/test_migration_additive_009.py`: down_revision `0007_item_units`; `item_serial` in metadata; `item` has `is_serialized`; unique (item_id,serial); SerialStatus has in_stock/sold
- [X] T018 [impl] Extend `scripts/check_contract_drift.py` with the 009 contract; the 001–008 gate stays green
- [X] T019 [P] [test] `tests/contract/test_serials_contract.py`: `/items/{id}/serials` GET + `/serials/receive` POST present; sale line schema exposes `serials`; item schema exposes `is_serialized`

---

## Phase 6: Frontend (Desktop, Arabic RTL)

- [X] T020 [impl] `frontend/src/pages/Catalog.tsx`: `is_serialized` toggle on item create/edit + a **«الأرقام التسلسلية»** action (receive serials + list in-stock)
- [X] T021 [impl] `frontend/src/pages/Invoices.tsx`: when a serialized item is on a line, capture its **serials** (count must equal quantity)
- [X] T022 [P] [impl] `tsc --noEmit` clean; load serials from `/api/v1/items/{id}/serials`

---

## Dependencies & Execution Order

Phase order: Setup (P1) → **Receive (P2)** → **Sell (P3)** → Return (P4) → Migration/Contract (P5) →
Frontend (P6).

### Test-before-impl pairings
- T005 before T006/T007; T009 before T010/T011; T013 before T014/T015.

### Key edges
- T001 → everything. T003 (service) → sales integration (T010/T014). T007 (receive) → T012/flow tests.

### Notes
- Additive only: one flag + one table; stock service untouched (called with serial-count quantity).
- Serial count == on-hand for serialized items; one serial = one base unit; money/ledger unchanged.
- Reuse existing capabilities; no new role. Purchase/produce/transfer serial capture deferred.
