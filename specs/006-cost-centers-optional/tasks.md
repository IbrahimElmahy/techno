---
description: "Task list for Cost Centers (analytical dimension) — additive to 001/005"
---

# Tasks: Cost Centers (Analytical Dimension)

**Input**: Design documents from `/specs/006-cost-centers-optional/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml
**Builds on**: Foundation (`001`) + General Ledger (`005`) — reuse the one immutable ledger, the 005
journal/trial-balance services, RBAC (`accounting.*` caps), and audit. **No new ledger, no new role.**

**Tests**: REQUIRED. Principle X — test-first for the four critical paths: **master rules** (unique code,
child-under-parent, deactivate-not-delete), **optional tagging** (line posts with/without; deactivated/
unknown rejected; balance unaffected), **reversal copies the cost center**, and **filtered trial balance**
(only that center; unfiltered unchanged). Each gets a failing [test] before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` red-green · `[US#]` user story · each cites its
FR(s). **Path base**: `backend/` (additive — one new table, one nullable `ledger_line` column, a new
service/router, small 005-service extensions; 001/002/003 posting paths untouched).

---

## Phase 1: Setup — Schema & Ledger Plumbing

- [X] T001 [impl] `src/models/cost_center.py`: `CostCenter` (id, code String(40) unique, name String(160), parent_id self-FK nullable, active bool default True) + self-referential `parent`/`children` relationship — data-model §cost_center; research R2
- [X] T002 [impl] `src/models/__init__.py`: import/register `CostCenter` for metadata
- [X] T003 [impl] Extend `src/models/ledger.py` `LedgerLine`: add `cost_center_id` (BigInteger, nullable, FK→cost_center.id, index) — data-model §ledger_line; research R1
- [X] T004 [impl] Extend `src/services/ledger_service.py`: `LineInput` gains `cost_center_id: int | None = None`; `post_entry` writes it onto each line; `reverse_entry` copies `line.cost_center_id` onto the mirror line — FR-004/006; research R4
- [X] T005 [impl] Extend `tests/conftest.py`: a cost-center factory + a `cost_centers` fixture (a root + two children) reusing the existing `chart` fixture — reused by all phases

**Checkpoint**: cost-center model + the optional ledger-line dimension exist; reversal carries it.

---

## Phase 2: Cost-Center Master — [US1] 🎯

**Goal**: Hierarchical master with unique codes, child-under-parent, deactivate-not-delete.
**Independent Test**: build a parent+child; duplicate code rejected; a used center cannot be hard-deleted.

### Tests first (Principle X)

- [X] T006 [P] [test] [US1] `tests/unit/test_cost_center_master.py`: unique `code` enforced; `parent_id` must exist; a center with tagged lines or active children cannot be hard-deleted (deactivated instead); only active centers are selectable — FR-001/002/003; SC-001

### Implementation (make T006 green)

- [X] T007 [impl] [US1] `src/services/cost_center_service.py`: `create(code, name, parent_id)` (unique code, parent-exists), `update(id, name, active)`, `deactivate(id)` (reject hard-delete of used/parent center → active=False); `is_active(id)` helper — FR-001/002/003; data-model §rules
- [X] T008 [impl] [US1] `src/api/cost_centers.py`: `GET /cost-centers` (flat + `tree=true` + active filter), `GET/POST /cost-centers`, `PATCH/DELETE /cost-centers/{id}` (capability `accounting.chart.*`); register router in `src/main.py` — contracts; FR-010
- [X] T009 [P] [test] [US1] `tests/integration/test_cost_centers_api.py`: CRUD via API; tree nesting; deactivate-not-delete (409); a non-accountant role denied (403, reuses 005 caps) — US1 scenarios; FR-010

**Checkpoint**: T006 green; a hierarchical cost-center master exists and is RBAC-gated.

---

## Phase 3: Tag Journal Lines — [US2] 🎯

**Goal**: Attach an optional cost center per journal line; reject deactivated/unknown; balance unaffected.
**Independent Test**: post a balanced entry, one line tagged + one untagged; both post; tag stored on the
first only; a line with a deactivated/unknown center → rejected.

### Tests first (Principle X)

- [X] T010 [P] [test] [US2] `tests/unit/test_journal_cost_center.py`: a line posts with `cost_center_id`; a line posts with NULL; a deactivated/unknown center is rejected; tagging does not change whether the entry balances — FR-004/005/007; SC-002
- [X] T011 [P] [test] [US2] `tests/unit/test_cost_center_reversal_copy.py`: reversing a tagged entry copies each line's `cost_center_id` onto the mirror line — FR-006; SC-003

### Implementation (make T010–T011 green)

- [X] T012 [impl] [US2] Extend `src/services/journal_service.py`: `JournalLineInput` gains `cost_center_id`; `post_entry` validates each referenced center is active (reject deactivated/unknown) then passes it to `ledger_service.LineInput` — FR-005
- [X] T013 [impl] [US2] Extend `src/api/accounting.py`: journal line schemas (`JournalLineIn`/`JournalLineOut`) gain `cost_center_id`; `GET /journal-entries` gains a `cost_center_id` query filter — FR-005/009; contracts

**Checkpoint**: T010–T011 green; journal lines carry an optional, validated cost center; reversal copies it.

---

## Phase 4: Filtered Trial Balance — [US3]

**Goal**: Trial balance scoped to one cost center; unfiltered output unchanged.
**Independent Test**: post under two centers; filter by one → only its movement; omit filter → unchanged.

### Tests first (Principle X)

- [X] T014 [P] [test] [US3] `tests/integration/test_trial_balance_cost_center.py`: filtered by a center aggregates only its lines; grand totals balance when entries are fully tagged with it; with no filter the result equals the pre-feature output (no regression) — FR-008; SC-004/005

### Implementation (make T014 green)

- [X] T015 [impl] [US3] Extend `src/services/trial_balance_service.py`: `trial_balance(..., cost_center_id=None)` — when set, include only lines with that `cost_center_id`; otherwise unchanged — FR-008; research R5
- [X] T016 [impl] [US3] Extend `src/api/accounting.py`: `GET /trial-balance` gains optional `cost_center_id` query param, passed through — FR-008; contracts

**Checkpoint**: T014 green; the trial balance has an optional cost-center axis with no regression.

---

## Phase 5: Migration, Contract & Polish

- [X] T017 [impl] Alembic `0005_cost_centers` (down_revision `0004_general_ledger`): create `cost_center` table (unique `code`, self-FK `parent_id`); `ALTER ledger_line ADD COLUMN cost_center_id` (+FK +index); additive only, no backfill — research R7
- [X] T018 [P] [test] `tests/integration/test_migration_additive_006.py`: down_revision is `0004_general_ledger`; `cost_center` in metadata; `ledger_line` has `cost_center_id`; `code` unique
- [X] T019 [impl] Extend `scripts/check_contract_drift.py` to include the 006 contract; the 001/002/003/005 gate stays green — Principle II
- [X] T020 [P] [test] `tests/contract/test_cost_centers_contract.py`: `/cost-centers` endpoints present in `/openapi.json`; journal line schema exposes `cost_center_id`; trial-balance exposes the `cost_center_id` query param; error envelopes (403/409/422)
- [X] T021 [P] [impl] Index review (`cost_center.code` unique, `ledger_line.cost_center_id` index) + run quickstart smoke end-to-end

---

## Phase 6: Frontend (Desktop, Arabic RTL)

- [X] T022 [impl] `frontend/src/pages/GeneralLedger.tsx`: add a **مراكز التكلفة** tab — tree table of cost centers + create/deactivate Drawer (reuses the chart-tab pattern)
- [X] T023 [impl] `frontend/src/pages/GeneralLedger.tsx`: journal-entry Drawer line rows gain a **cost-center** selector (optional); opening unaffected
- [X] T024 [impl] `frontend/src/pages/GeneralLedger.tsx`: trial-balance tab gains a **cost-center** filter select; passed as `cost_center_id`
- [X] T025 [P] [impl] `tsc --noEmit` clean; load cost-center list from `/api/v1/cost-centers?active=true`

---

## Dependencies & Execution Order

### Phase order (hard sequence)
Setup (P1) → **Master (P2)** → **Tag lines (P3)** → Filtered trial balance (P4) → Migration/Contract (P5)
→ Frontend (P6).

Rationale: tagging needs the master (P2 before P3) and the ledger-line column (P1); the filtered report
needs tagged lines (P4 after P3); the frontend consumes all endpoints (P6 last).

### Test-before-impl pairings (Principle X)
- T006 (master rules) **before** T007–T008.
- T010–T011 (tagging, reversal-copy) **before** T012–T013.
- T014 (filtered trial balance) **before** T015–T016.

### Key blocking edges
- T001/T003 → everything (model + column).
- T004 (LineInput + reverse copy) → T011, T012.
- T007 (service) → T012 (journal validation needs `is_active`).
- T008 (router) → frontend P6.

### Parallel opportunities
- Critical-path tests T006/T010/T011/T014 mutually parallel (each before its own impl).
- Frontend tabs T022/T023/T024 are sequential within one file but independent of backend once endpoints exist.

---

## Implementation Strategy

### MVP backbone first
1. P1–P2: model + master (the dimension's values).
2. P3: tag journal lines — the capture path.
3. **STOP and VALIDATE**: master + tagging + reversal-copy green before the report.

### Incremental delivery
- +Filtered trial balance (P4) → analysis. +Migration/Contract (P5) → ship on MySQL. +Frontend (P6) → visible.

### Notes
- Additive only: one table, one nullable column; 001/002/003 post `cost_center_id=None` (unchanged).
- Reuse 005 `accounting.*` capabilities; no new role.
- Partial tagging is allowed; the filtered trial balance surfaces inequality, never errors.
