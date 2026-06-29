---
description: "Task list for Foundation (Shared Base) implementation"
---

# Tasks: Foundation (Shared Base)

**Input**: Design documents from `/specs/001-foundation/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml

**Tests**: REQUIRED. Constitution Principle X mandates test-first for ledger posting, reversal
symmetry, balance derivation, and access-control denials. Each such area's failing unit test
([test]) is written and committed **before** its implementation ([impl]).

**Labels**:
- `[P]` — parallelizable (different files, no incomplete dependency)
- `[test]` / `[impl]` — explicit red-green pairing
- `[US#]` — the user story the task primarily serves
- Each task notes the FR(s) and/or acceptance scenario(s) it satisfies.

**Path base**: `backend/` (see plan.md Project Structure).

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [impl] Create `backend/` project structure (`src/`, `tests/`, `migrations/`) per plan.md
- [X] T002 [impl] Initialize Python 3.12 project + `backend/requirements.txt` (fastapi, sqlalchemy 2.x, alembic, pydantic v2, passlib[bcrypt], python-jose, uvicorn, pytest, pytest-asyncio, httpx)
- [X] T003 [P] [impl] Configure tooling: ruff + black + `pytest.ini`/`pyproject.toml` in `backend/`
- [X] T004 [P] [impl] Implement `src/core/config.py` (Settings: DATABASE_URL, JWT_SECRET, ACCESS_TOKEN_TTL)
- [X] T005 [P] [impl] Implement `src/core/db.py` (SQLAlchemy engine, session factory, declarative `Base`)
- [X] T006 [P] [impl] Implement `src/core/money.py` (EGP `Decimal(18,2)` helpers; no float) — FR-029

**Checkpoint**: Project builds; empty app importable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Must complete before any domain phase.

- [X] T007 [impl] Initialize Alembic in `backend/migrations/`; wire `env.py` to `Base.metadata` (models-as-source-of-truth) — research R9
- [X] T008 [impl] Implement `src/main.py` FastAPI app factory + router registration stub
- [X] T009 [impl] Implement `tests/conftest.py`: disposable MySQL schema fixture, ASGI `httpx` client fixture, per-role auth-token fixtures (admin, branch_manager, sales_manager, after_sales, sales_rep)

**Checkpoint**: `pytest` runs (0 tests) against a throwaway DB; migrations apply.

---

## Phase 3: Ledger Core (the heart — all balances derive from here) 🎯 MVP backbone

**Goal**: Immutable double-entry ledger with reversal-linkage and derived balances.
**Independent Test**: Post a balanced entry, reverse it once, and confirm `balance_of` equals the
signed sum of lines; unbalanced entries and mutation attempts are rejected.

### Tests first (Principle X — write and commit RED before impl)

- [X] T010 [P] [test] `tests/unit/test_ledger_posting.py`: balanced entry commits; Σdebit≠Σcredit rejected; <2 lines rejected; UPDATE/DELETE on posted entry/line rejected — FR-024, FR-028
- [X] T011 [P] [test] `tests/unit/test_ledger_reversal.py`: `reverse_entry` mirrors legs (debit↔credit), sets `reverses_entry_id`, original untouched, second reversal of same entry → error, a reversal entry is itself not re-reversible — FR-027, Principle IV
- [X] T012 [P] [test] `tests/unit/test_balance_derivation.py`: `balance_of(account)` == signed Σ lines after postings + a reversal; no stored balance column — FR-026, SC-004, SC-005

### Implementation (make T010–T012 green)

- [X] T013 [impl] `src/models/ledger.py`: `Account` model (account_type, owner_ref, normal_side, active) — data-model §1
- [X] T014 [impl] `src/models/ledger.py`: `LedgerEntry` model (actor, rep_id, branch_id, `reverses_entry_id` UNIQUE) — depends on T013
- [X] T015 [impl] `src/models/ledger.py`: `LedgerLine` model (entry_id, account_id, direction, amount>0; index on account_id) — depends on T014
- [X] T016 [impl] Alembic baseline migration creating `account`/`ledger_entry`/`ledger_line` + **immutability trigger** (reject UPDATE/DELETE) + SQLAlchemy event guard — FR-028, research R2; depends on T015
- [X] T017 [impl] `src/services/ledger_service.py` `post_entry()`: validate ≥2 lines + Σdebit=Σcredit, append-only — FR-024; depends on T015
- [X] T018 [impl] `src/services/ledger_service.py` `reverse_entry()`: create mirror linked entry, enforce reverse-once (UNIQUE `reverses_entry_id`); reversal not re-reversible — FR-027; depends on T017
- [X] T019 [impl] `src/services/ledger_service.py` `balance_of(account_id)`: signed Σ over lines — FR-026; depends on T015

**Checkpoint**: T010–T012 green. Ledger is the verified source of truth.

---

## Phase 4: Identity & RBAC (deny-by-default, server-side) — [US2][US4][US5]

**Goal**: Authentication + the deny-by-default authorization layer with branch/rep scope.
**Independent Test**: A token with no granted capability is denied; a branch manager cannot touch
another branch; a sales manager is limited to own-branch sales; a rep cannot touch another rep's
data or any back-office action.

### Tests first (Principle X — access-control denials)

- [X] T020 [P] [test] [US2] `tests/unit/test_access_control.py`: deny-by-default (no capability → 403); branch manager cross-branch read & write denied — FR-002, FR-007, FR-011, SC-002, SC-006; US2 scenarios 1–2
- [X] T021 [P] [test] [US4] `tests/unit/test_access_control.py::rep_scope`: rep sees only own data; other-rep id → denied; back-office action → denied — FR-009, SC-003; US4 scenarios 2–3
- [X] T022 [P] [test] [US5] `tests/unit/test_access_control.py::sales_manager_scope`: Sales Manager own-branch sales/customer/report reads allowed; cross-branch reads denied; any org/user/warehouse/treasury (branch-administration) action denied — FR-008a, SC-002; US5 scenarios 1–2
- [X] T023 [P] [test] [US2] `tests/integration/test_scope_revocation.py`: removed branch assignment denies mid-session — spec Edge Case; FR-004

### Implementation (make T020–T023 green)

- [X] T024 [P] [impl] `src/models/role.py`: `Role` (six-role enum) — FR-005, data-model §2
- [X] T025 [impl] `src/models/user.py`: `User` (username UNIQUE, password_hash, role, branch_id, territory_id, active) — FR-001, FR-003; depends on T024
- [X] T026 [impl] Alembic migration for `role` + `user` — depends on T025
- [X] T027 [P] [impl] `src/core/security.py`: bcrypt hashing + JWT issue/verify (claims: user_id, role, branch_id, rep_id, active) — research R5
- [X] T028 [impl] `src/auth/rbac.py`: static role→capability map + deny-by-default resolver (includes Sales Manager own-branch sales capabilities) — FR-008a, FR-010, FR-011; depends on T024
- [X] T029 [impl] `src/auth/dependencies.py`: `get_current_user`, `require_capability`, scope predicates (`same_branch`, `own_rep`, `any`); re-checks `active`/scope per request — FR-002, FR-004, FR-010; depends on T027, T028
- [X] T030 [impl] `src/api/auth.py`: `POST /auth/login`, `GET /auth/me` — FR-001; depends on T029
- [X] T031 [impl] `src/api/users.py`: list/create/get + `POST /users/{id}/deactivate` (scope-enforced) — FR-003, FR-006, FR-007; depends on T029

**Checkpoint**: T020–T023 green. Every later endpoint can require capability + scope.

---

## Phase 5: Organization — [US1][US2]

**Goal**: Head office → branches (governorates) → territories (each within one branch).
**Independent Test**: Admin creates a branch + territory; a second branch's data is invisible to the
first branch's manager.

- [X] T032 [P] [impl] [US1] `src/models/org.py`: `Governorate`, `HeadOffice`, `Branch` (governorate_id) — FR-012, data-model §3
- [X] T033 [impl] [US1] `src/models/org.py`: `Territory` (branch_id; within exactly one branch) — FR-014; depends on T032
- [X] T034 [impl] [US1] Alembic migration for org tables — depends on T033
- [X] T035 [impl] [US1] `src/api/org.py`: governorates (list), branches (list/create — admin only), territories (list/create) with scope filtering — FR-012, FR-014; US1 scenario 1; depends on T029, T033
- [X] T036 [P] [test] [US1] `tests/integration/test_org_setup.py`: admin creates head office + 2 branches + territories (US1 scenario 1)
- [X] T037 [P] [test] [US2] `tests/integration/test_branch_isolation.py`: branch-scoped lists return own branch only; cross-branch get → 403 — US2 scenarios 1–3; SC-002

**Checkpoint**: Org tree exists and is branch-isolated.

---

## Phase 6: Warehouses & Custodies — [US1]

**Goal**: Central + branch warehouses; exactly one custody per rep / per warehouse, balance derived.
**Independent Test**: Create warehouses + a rep custody; a second custody for the same holder → 409;
custody balance reads from the ledger.

- [X] T038 [P] [impl] [US1] `src/models/warehouse.py`: `Warehouse` (type central/branch, branch_id) — FR-015, FR-016, FR-017, data-model §4
- [X] T039 [impl] [US1] `src/models/warehouse.py`: `Custody` (holder_type, rep_id/warehouse_id, UNIQUE per holder) — FR-025; depends on T038
- [X] T040 [impl] [US1] Alembic migration for `warehouse` + `custody` (unique constraints) — depends on T039
- [X] T041 [impl] [US1] Custody creation wires a `custody` `Account` row (ledger linkage) — FR-025, FR-026; depends on T013, T039
- [X] T042 [impl] [US1] `src/api/warehouses.py`: warehouses list/create, custodies list/create, `GET /custodies/{id}/balance` (derived) — FR-015, FR-025; US1 scenario 2; depends on T019, T029, T041
- [X] T043 [P] [test] [US1] `tests/integration/test_custody_uniqueness.py`: second custody for same rep/warehouse → 409 — FR-025
- [X] T044 [P] [test] [US1] `tests/integration/test_treasury_balance.py`: singleton treasury account, `GET /treasury/balance` == 0 derived at setup — FR-024, US1 scenario 4, SC-004

**Checkpoint**: Locations exist; balances derive from the ledger.

---

## Phase 7: Customers + Receivables + Reassignment — [US3][US4]

**Goal**: Central customers (system code, type, single rep/territory ownership), ledger-derived
receivable accounts, and reassignment that preserves account/balance + history attribution.
**Independent Test**: Create a trader customer (balance 0 derived); reassign to another rep and
confirm same account/balance while prior ledger entries stay attributed to the original rep.

- [X] T045 [P] [impl] [US3] `src/models/customer.py`: `Customer` (code UNIQUE, type, phone non-unique, rep_id, territory_id, active) — FR-018, FR-018a, FR-019, FR-020, FR-023, data-model §5. **No loyalty column** (loyalty owned by After-Sales; FR-022)
- [X] T046 [impl] [US3] `src/models/customer.py`: `CustomerAccount` (UNIQUE customer_id) + its `customer_receivable` Account row — FR-021, FR-026; depends on T013, T045
- [X] T047 [impl] [US3] Alembic migration for `customer` + `customer_account` — depends on T046
- [X] T048 [impl] [US3] `src/services/customer_service.py` `create()`: system-generated `code`, duplicate-phone flag (warn not block), auto-create account — FR-018a, FR-021; depends on T046
- [X] T049 [impl] [US3] `src/services/customer_service.py` `reassign()`: update rep_id+territory_id only; account/balance untouched; admin & branch/purchasing manager only — FR-020a; US3 scenario 4; depends on T048
- [X] T050 [impl] [US3] `src/api/customers.py`: list (scope-filtered), create, get, `POST /{id}/reassign`, `GET /{id}/account` (derived balance) — FR-018–FR-021, FR-020a; depends on T019, T029, T049
- [X] T051 [P] [test] [US3] `tests/integration/test_customer_account.py`: create trader → account balance 0 derived, not stored; stable `code` present and no loyalty schema exists — US3 scenarios 1–3; SC-004; FR-022
- [X] T052 [P] [test] [US3] `tests/integration/test_customer_reassign.py`: reassign keeps same account/balance; prior entries attributed to original rep — US3 scenario 4; FR-020a
- [X] T053 [P] [test] [US4] `tests/integration/test_rep_customer_scope.py`: rep `GET /customers` returns only own; other-rep customer → 403 — US4 scenario 2; FR-009
- [X] T054 [P] [test] [US3] `tests/integration/test_no_hard_delete.py`: deleting a branch/warehouse/customer referenced by a ledger entry is blocked; deactivation preserves history and references — FR-023; spec Edge Case

**Checkpoint**: Customers + receivables work; reassignment is safe and isolated; referenced records cannot be hard-deleted.

---

## Phase 8: Audit Log — cross-cutting

**Goal**: Append-only audit of write/security actions with actor, timestamp, before/after.
**Independent Test**: Each audited action writes exactly one record with full attribution.

- [X] T055 [P] [impl] `src/models/audit.py`: `AuditLogEntry` (actor, action, entity_type/id, before_json, after_json, created_at) — FR-031, data-model §7
- [X] T056 [impl] Alembic migration for `audit_log_entry` — depends on T055
- [X] T057 [impl] `src/services/audit_service.py` `record(actor, action, before, after)` (append-only) — FR-031; depends on T055
- [X] T058 [impl] Wire audit hooks into: login success/fail (T030), role/permission change & user deactivate (T031), customer reassign (T049), ledger post/reverse (T017–T018) — FR-031; depends on T057
- [X] T059 [impl] `src/api/audit.py`: `GET /audit` query (scope-enforced) — FR-031; depends on T029, T057
- [X] T060 [P] [test] `tests/integration/test_audit_coverage.py`: each of login(success/fail), role change, reassignment, deactivation, ledger post/reverse → exactly one audit record with before/after — SC-007

**Checkpoint**: All write/security actions are auditable.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T061 [P] [impl] `src/seed.py`: seed Egyptian governorates + first System Admin — quickstart
- [X] T062 [impl] Contract-drift CI check: assert FastAPI `/openapi.json` matches `specs/001-foundation/contracts/openapi.yaml` — Principle II
- [X] T063 [P] [test] `tests/contract/`: per-endpoint-group response-shape + error-envelope (401/403/404/422) tests against `contracts/openapi.yaml`
- [X] T064 [P] [impl] Add DB indexes review (ledger_line.account_id, customer.code, user.username) + run quickstart smoke test end-to-end — plan Performance

---

## Dependencies & Execution Order

### Phase order (hard sequence)
Setup (P1) → Foundational (P2) → **Ledger Core (P3)** → Identity & RBAC (P4) → Organization (P5)
→ Warehouses & Custodies (P6) → Customers & Receivables (P7) → Audit (P8) → Polish (P9).

Rationale: every balance derives from the ledger (P3 first); every endpoint requires the RBAC
dependency (P4 before all domain endpoints); customers/warehouses post to ledger accounts (need P3).

### Test-before-impl pairings (Principle X)
- T010–T012 (ledger posting / reversal / balance) **before** T013–T019.
- T020–T023 (access-control denials, incl. Sales Manager scope T022) **before** T024–T031.

### Key blocking edges
- T013 → T014 → T015 → T016/T017; T017 → T018; T015 → T019.
- T027 + T028 → T029 → all domain endpoints (T030, T031, T035, T042, T050, T059).
- T013 → T041 (custody account), T046 (customer account).

### Parallel opportunities
- Setup: T003, T004, T005, T006 in parallel.
- Ledger tests T010, T011, T012 in parallel (different files); models T013→T014→T015 are sequential (same file).
- RBAC tests T020, T021, T022, T023 in parallel; T024 and T027 in parallel.
- Domain test files (T036/T037, T043/T044, T051/T052/T053/T054, T060, T063) are mutually parallel.

---

## Implementation Strategy

### MVP backbone first
1. Phases 1–3 deliver the verified immutable ledger — the irreducible core (US1 scenario 4 provable).
2. Phase 4 delivers auth + deny-by-default — the security boundary (US2/US4/US5).
3. **STOP and VALIDATE**: ledger green + access-control green before any domain CRUD.

### Incremental delivery
- +Phase 5 (org) → admin can stand up branches (US1 scenario 1) → demo.
- +Phase 6 (warehouses/custodies) → US1 scenario 2 + treasury derived (US1 scenario 4) → demo.
- +Phase 7 (customers) → US3 + US4 → demo.
- +Phase 8 (audit) → SC-007 → demo.
- +Phase 9 → contract-drift gate + seed + smoke.

### Notes
- `[P]` tasks = different files, no incomplete dependency.
- Money assertions use `Decimal`, never float.
- No product/invoice/stock/coupon/employee tables introduced (out of scope; no over-commit).
- No loyalty columns or tables (loyalty owned by the After-Sales spec; constitution v1.1.2, FR-022).
- Custody-holder reassignment is out of scope for Foundation (accepted gap; spec Edge Cases).
