---
description: "Task list for Barcodes per Item — additive to 002/008"
---

# Tasks: Barcodes per Item

**Input**: Design documents from `/specs/010-barcodes-per-item/`
**Builds on**: Sales & Inventory (`002`) + Multiple Units (`008`). Read-only lookup; no 002–009 behaviour
change.

**Tests**: REQUIRED. Principle X — test-first for: **global uniqueness**, **per-unit validation**, and the
**lookup** (factor + 404). Each gets a failing [test] before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` · `[US#]` · cites FR(s). Path base: `backend/`.

---

## Phase 1: Setup — Model & Service

- [X] T001 [impl] Extend `src/models/catalog.py`: `ItemBarcode` (item_id FK indexed, barcode String(64) UNIQUE, unit String(16) nullable) — data-model; research R1
- [X] T002 [impl] `src/models/__init__.py`: register `ItemBarcode`
- [X] T003 [impl] `src/services/barcode_service.py`: `set_barcodes(db, item, items)` (distinct-in-set; global-unique; unit base-or-defined) + `lookup(db, code)` → item+unit+factor via `uom_service` (None if unknown) — research R2/R3
- [X] T004 [impl] Extend `tests/conftest.py`: a `make_barcode(db, item, code, unit)` helper

**Checkpoint**: barcode model + service exist.

---

## Phase 2: Rules + Lookup — [US1][US2] 🎯

### Tests first (Principle X)
- [X] T005 [P] [test] [US1][US2] `tests/unit/test_barcode_rules.py`: global-unique enforced (reuse across items rejected); unit must be base or a defined item_unit; `lookup` returns unit+factor (carton→12, base→1); unknown → None — FR-001/002/004; SC-001/002/003

### Implementation (make T005 green)
- [X] T006 [impl] [US1][US2] `src/services/barcode_service.py` per the spec — research R2/R3

**Checkpoint**: T005 green; rules + lookup verified as pure logic.

---

## Phase 3: API — [US1][US2]

- [X] T007 [impl] [US1] `src/api/catalog.py`: `GET /items/{id}/barcodes` and `PUT /items/{id}/barcodes` (catalog.write; replace set) — contracts; FR-001/002/003
- [X] T008 [impl] [US2] `src/api/catalog.py`: `GET /barcodes/{code}` lookup (catalog.read; 404 unknown) — contracts; FR-004/005
- [X] T009 [P] [test] [US1][US2] `tests/integration/test_barcodes_api.py`: set/read barcodes; duplicate (other item) → 422; unknown unit → 422; lookup returns item+unit+factor; unknown → 404; non-catalog-writer set → 403 — US1/US2; FR-001–005

**Checkpoint**: barcodes manageable + scannable end-to-end.

---

## Phase 4: Migration, Contract & Polish

- [X] T010 [impl] Alembic `0009_barcodes` (down_revision `0008_serials`): create `item_barcode` (unique barcode, FK item); additive, no backfill — research R5
- [X] T011 [P] [test] `tests/integration/test_migration_additive_010.py`: down_revision `0008_serials`; `item_barcode` in metadata; `barcode` unique
- [X] T012 [impl] Extend `scripts/check_contract_drift.py` with the 010 contract; the 001–009 gate stays green
- [X] T013 [P] [test] `tests/contract/test_barcodes_contract.py`: `/items/{id}/barcodes` GET/PUT + `/barcodes/{code}` GET present

---

## Phase 5: Frontend (Desktop, Arabic RTL)

- [X] T014 [impl] `frontend/src/pages/Catalog.tsx`: a **«الباركود»** editor (list barcodes + optional unit per barcode)
- [X] T015 [impl] `frontend/src/pages/Invoices.tsx`: a **scan/enter barcode** field that looks up and adds a line (item + unit prefilled)
- [X] T016 [P] [impl] `tsc --noEmit` clean; lookup via `/api/v1/barcodes/{code}`

---

## Dependencies & Execution Order

Phase order: Setup (P1) → **Rules+Lookup (P2)** → API (P3) → Migration/Contract (P4) → Frontend (P5).

### Test-before-impl pairings
- T005 before T006; T009 with T007/T008.

### Notes
- Additive only: one table + a read-only lookup; reuses 008 factor resolution.
- Reuse catalog.read/write; no new role. Scale/weighted barcode deferred.
