---
description: "Task list for General Ledger & Chart of Accounts implementation (additive to 001/002/003)"
---

# Tasks: General Ledger & Chart of Accounts

**Input**: Design documents from `/specs/005-general-ledger/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml
**Builds on**: Foundation (`001`) + Sales & Inventory (`002`) + After-Sales Loyalty (`003`) — reuse the
**one** immutable ledger (`ledger_entry`/`ledger_line`), RBAC, branches, audit, and `account_resolver`.
**No new ledger.** The chart is the `account` table extended; a journal entry IS a balanced `ledger_entry`.

**Tests**: REQUIRED. Principle X mandates test-first for the five critical paths: **journal balancing**
(Σdebit=Σcredit), **postable-leaf-only posting**, **account code/hierarchy validation**, **trial-balance
derivation** (per-account = Σ lines; grand totals equal), and **reverse-once**. Each gets a failing
[test] before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` red-green · `[US#]` user story · each task cites
its FR(s)/scenario(s). **Path base**: `backend/` (additive — the only existing-model change is additive
columns on `account` and `ledger_line`, and additive enum values; 002/003 posting paths unchanged).

---

## Phase 1: Setup — Schema, Enums & RBAC Extension

- [X] T001 [impl] Extend `src/models/ledger.py`: add `AccountNature` enum (asset|liability|equity|income|expense); add `Account` columns `parent_id` (FK self, nullable), `code` (String(40), unique), `name` (String(160)), `nature` (Enum, nullable), `is_postable` (bool, default True), `is_system` (bool, default False) — data-model §1; research R1/R2
- [X] T002 [impl] Extend `src/models/ledger.py` `AccountType` enum with `opening_balance_equity` (nature=equity, normal credit, singleton, is_system) — research R5; data-model §AccountType
- [X] T003 [impl] Extend `src/models/ledger.py`: `LedgerLine` `statement` (String(255), nullable) — per-line بيان; and `LedgerEntry` `entry_date` (Date, nullable) — the **accounting date** the trial balance filters by (NOT `created_at`); legacy posts fall back to `created_at::date` — research R4/R6; analysis finding A; data-model §ledger_line/§ledger_entry
- [X] T004 [P] [impl] Extend `src/models/role.py` `RoleName` enum with `accountant` — FR-015; research R7
- [X] T005 [P] [impl] Extend `src/auth/rbac.py`: capabilities `accounting.chart.read`, `accounting.chart.write`, `accounting.journal.post`, `accounting.journal.reverse`, `accounting.trial_balance.read`; grant the full set to `accountant` + `system_admin` (deny-by-default for all other roles) — FR-015; research R7
- [X] T006 [impl] Extend `src/services/account_resolver.py`: add `opening_balance_equity` to `NORMAL_SIDE`; add `opening_balance_equity_account()` (get-or-create singleton) — research R5
- [X] T007 [impl] Extend `tests/conftest.py` fixtures: an `accountant` user/token factory, a chart-account factory (group + postable leaf), and a postable-leaf pair for journal tests — reused by all phases

**Checkpoint**: schema columns + enums modeled; Accountant role & capabilities live; resolver knows the equity account.

---

## Phase 2: Chart of Accounts (hierarchy, codes, postable rules) — [US1] 🎯 backbone

**Goal**: User-defined hierarchical chart over the same `account` rows; segmented codes; group vs leaf.
**Independent Test**: Build Assets→Cash→sub; code prefix enforced; group node rejects a journal line later;
system accounts present and read-only; used/parent account cannot be hard-deleted.

### Tests first (Principle X — code/hierarchy validation)

- [X] T008 [P] [test] [US1] `tests/unit/test_account_code_hierarchy.py`: child `code` must start with `parent.code + "."`; duplicate code rejected; root has no dot — FR-002/017; research R3
- [X] T009 [P] [test] [US1] `tests/integration/test_chart_crud.py`: build a multi-level tree; mark a node group (is_postable=False); deactivate-not-delete an account with children/lines (409); the 7 system accounts + opening_balance_equity appear as postable `is_system` leaves under their groups; a system account is renamable but not deletable — FR-001/003/004/005; US1 scenarios 1–4

### Implementation (make T008–T009 green)

- [X] T010 [impl] [US1] `src/services/chart_service.py`: `create_account()` (validate code prefix-of-parent, uniqueness, parent must be a group, nature/normal_side derivation), `update_account()` (rename/activate), `deactivate_account()` (reject hard-delete of used/parent/system; set active=False) — FR-001/002/003/005; data-model §rules
- [X] T011 [impl] [US1] `src/api/accounting.py` chart routers: `GET /accounts` (flat + `tree=true` nested + filters), `GET/POST /accounts`, `PATCH/DELETE /accounts/{id}` (capability `accounting.chart.*`; `balance` derived per account) — contracts; FR-001–005
- [X] T012 [P] [impl] [US1] `src/services/chart_service.py` `account_balance(account_id)` = signed Σ lines (leaf) / subtree roll-up (group) — reuse for the `Account.balance` field — Principle VI/IX

**Checkpoint**: T008–T009 green. A real chart of accounts exists over the one ledger; system accounts intact.

---

## Phase 3: Manual Journal Entries (balanced, postable-only, immutable) — [US2] 🎯 the heart

**Goal**: Post a dated, described, ≥2-line balanced entry on postable leaves → one immutable `ledger_entry`.
**Independent Test**: Balanced entry posts and moves both account balances; unbalanced → 422; group-account
line → 422; entry is immutable (inherited guard); audit logged.

### Tests first (Principle X — balancing & postable-only)

- [X] T013 [P] [test] [US2] `tests/unit/test_journal_balanced.py`: Σdebit ≠ Σcredit rejected; <2 lines rejected; balanced posts as ONE `ledger_entry` with `entry_type="journal"` — FR-006/007/008; SC-002
- [X] T014 [P] [test] [US2] `tests/unit/test_postable_only.py`: a line on a group (is_postable=False) account is rejected — FR-003/006; SC-001

### Implementation (make T013–T014 green)

- [X] T015 [impl] [US2] `src/services/journal_service.py` `post_entry(db, *, date, description, branch_id, lines, actor)`: validate every account postable+active, then delegate balancing/≥2-lines/positive-amount to Foundation `ledger_service.post_entry` (entry_type="journal", set `entry_date=date`, `statement` per line) → inherits immutability; then **explicitly** `audit_service.record(...)` (post_entry does NOT auto-audit) — FR-006/007/008/010; analysis finding B
- [X] T016 [impl] [US2] `src/api/accounting.py` journal routers: `GET /journal-entries` (date/branch filter), `GET /journal-entries/{id}` (with lines), `POST /journal-entries` (capability `accounting.journal.post`; branch scope: branch-bound user posts own branch only) — contracts; FR-006/016
- [X] T017 [P] [test] [US2] `tests/integration/test_journal_post_api.py`: post via API moves balances; cross-branch post by a branch-scoped user rejected (403/422); audit row written; entry immutable — US2 scenarios 1–5; FR-016

**Checkpoint**: manual journals post to the one ledger, balanced, immutable, branch-scoped, audited.

---

## Phase 4: Reversal (reverse-once) — [US2]

**Goal**: Correct a journal entry only by a linked reversing entry; never edit/delete; reverse at most once.
**Independent Test**: Reverse an entry → mirror lines posted, balances net to zero; second reverse → 409.

### Tests first (Principle X — reverse-once)

- [X] T018 [P] [test] [US2] `tests/unit/test_journal_reverse_once.py`: reversing entry mirrors directions and sets `reverses_entry_id`; a second reversal of the same entry rejected; reversing a reversal rejected — FR-009; SC-005

### Implementation

- [X] T019 [impl] [US2] `src/services/journal_service.py` `reverse_entry(db, entry_id, actor)`: delegate to Foundation `ledger_service.reverse_entry` (mirror lines, `reverses_entry_id` UNIQUE → reverse-once, entry_type="reversal"); **extend that Foundation helper additively to carry the original's `entry_date`** so the reversal nets in the same period; then **explicitly** `audit_service.record(...)` — FR-009/010; analysis finding B/C
- [X] T020 [impl] [US2] `src/api/accounting.py`: `POST /journal-entries/{id}/reverse` (capability `accounting.journal.reverse`) — contracts; FR-009

**Checkpoint**: journal corrections are append-only and reverse-once.

---

## Phase 5: Opening Balances — [US3]

**Goal**: Enter opening balances as one balanced entry against `opening_balance_equity`; included in balances.
**Independent Test**: Opening balances for cash + a customer → balanced vs equity; account balances reflect openings.

- [X] T021 [P] [test] [US3] `tests/integration/test_opening_balances.py`: each line posts on its account's normal side, total offsets `opening_balance_equity`; entry_type="opening_balance"; balances include openings; non-postable account rejected — FR-011; US3 scenarios 1–2
- [X] T022 [impl] [US3] `src/services/opening_balance_service.py` `post_opening_balances(db, *, date, branch_id, lines, actor)`: build balanced lines (account normal side) + the offsetting equity line; reuse `journal_service` machinery — FR-011; research R5
- [X] T023 [impl] [US3] `src/api/accounting.py`: `POST /opening-balances` (capability `accounting.journal.post`) — contracts; FR-011

**Checkpoint**: opening balances enter the books as ordinary, derived ledger movement.

---

## Phase 6: Trial Balance (derived, group roll-up, balanced) — [US4]

**Goal**: Per-account opening/debit/credit/closing for a date range; group roll-up; grand totals equal.
**Independent Test**: After entries, trial balance shows each account = signed Σ lines; parents roll up
children; grand_total_debit == grand_total_credit; branch filter scopes.

### Tests first (Principle X — derivation & totals)

- [X] T024 [P] [test] [US4] `tests/unit/test_trial_balance_derivation.py`: per postable account opening = Σ(lines with `entry_date` before from), period_debit/credit by direction in range (by `entry_date`), closing = opening + movement on normal side; a **back-dated opening-balance entry posted today appears in the correct period** (filter by `entry_date`, not `created_at`); grand totals equal; empty range → zero rows/totals not error — FR-012/013/014; SC-003/004; analysis finding A
- [X] T025 [impl] [US4] `src/services/trial_balance_service.py` `trial_balance(db, *, from, to, branch_id=None, include_groups=True)`: derive rows from `ledger_line`/`ledger_entry`; subtree roll-up by `parent_id`; compute grand totals + `balanced` — FR-012/013/014; research R6
- [X] T026 [impl] [US4] `src/api/accounting.py`: `GET /trial-balance` (required from/to, optional branch_id/include_groups; capability `accounting.trial_balance.read`; branch scope for non-admin) — contracts; FR-012/016
- [X] T027 [P] [test] [US4] `tests/integration/test_trial_balance_report.py`: opening+movement+closing across a multi-entry book; group rows rolled up; branch filter; grand totals equal — US4 scenarios 1–4

**Checkpoint**: the trial balance reads the source of truth and always balances.

---

## Phase 7: Migration, Contract & Polish

- [X] T028 [impl] Confirm chart/role models registered in `src/models/__init__.py`; verify `Base.metadata` create_all (SQLite) and the migration (MySQL) agree
- [X] T029 [impl] Alembic `0004_general_ledger` (down_revision `0003_after_sales_loyalty`): `ALTER account` add chart columns + unique index on `code`; MySQL `MODIFY` `account_type` enum (+`opening_balance_equity`); `ALTER ledger_line` add `statement`; `ALTER ledger_entry` add `entry_date` (DATE, nullable); MySQL `MODIFY` `role` enum (+`accountant`) and seed the `accountant` role; data seed — create standard group headings, set `nature`/`is_postable`/`is_system` and re-home the 7 system accounts under their groups, create `opening_balance_equity`, assign codes — research R8; additive only (no drops, no money backfill)
- [X] T030 [P] [test] `tests/integration/test_migration_additive_005.py`: down_revision is `0003_after_sales_loyalty`; `account` has the new columns; `AccountType` includes `opening_balance_equity`; `RoleName` includes `accountant`; the 7 system accounts re-homed with nature/is_postable/is_system; `ledger_line` has `statement`; `ledger_entry` has `entry_date`
- [X] T031 [impl] Extend `scripts/check_contract_drift.py` to include the 005 contract; the 001+002+003 gate stays green — Principle II
- [X] T032 [P] [test] `tests/contract/test_accounting_contract.py`: new endpoints present in `/openapi.json`; error envelopes (403 RBAC/scope, 409 duplicate-code/already-reversed, 422 unbalanced/non-postable) — contracts
- [X] T033 [P] [impl] Index review (`account(parent_id)`, `account.code` UNIQUE, `ledger_line(account_id)` already present) + run quickstart smoke end-to-end

---

## Dependencies & Execution Order

### Phase order (hard sequence)
Setup (P1) → **Chart of Accounts (P2)** → **Manual Journal Entries (P3)** → Reversal (P4) → Opening
Balances (P5) → Trial Balance (P6) → Migration/Contract/Polish (P7).

Rationale: journals need postable accounts (P2 before P3); reversal & openings build on `journal_service`
(P3 before P4/P5); the trial balance needs entries to derive from (P6 after P3–P5); the migration seeds the
chart the runtime expects (P7 consolidates).

### Test-before-impl pairings (Principle X)
- T008 (code/hierarchy) **before** T010–T012.
- T013–T014 (balancing / postable-only) **before** T015–T016.
- T018 (reverse-once) **before** T019–T020.
- T024 (trial-balance derivation) **before** T025–T026.

### Key blocking edges
- T001/T002 → everything (chart columns + equity account type).
- T005 (capabilities) → all routers (T011, T016, T020, T023, T026).
- T010 (chart_service) → T015 (postable validation in journals).
- T015 (post_entry) → {T019 reversal, T022 openings}; T025 (trial balance) needs entries from T015/T022.
- T006 (equity resolver) → T022 (opening balances).

### Parallel opportunities
- Setup: T004, T005 parallel; T007 after models exist.
- Critical-path tests T008/T013/T014/T018/T024 mutually parallel across phases (each before its own impl).
- Integration tests T009, T017, T021, T027, T030, T032 mutually parallel.

---

## Implementation Strategy

### MVP backbone first
1. Phase 1–2: schema + chart of accounts over the one ledger (the biggest A5Group gap).
2. Phase 3: manual balanced journal entries — the core accounting loop.
3. **STOP and VALIDATE**: chart CRUD + balanced/postable-only journals green before reversal/reports.

### Incremental delivery
- +Reversal (P4) → safe corrections. +Opening balances (P5) → migrate-ready books. +Trial balance (P6) →
  the headline report. +Migration/Polish (P7) → ship on MySQL.

### Notes
- One ledger only: a journal entry IS a `ledger_entry`; immutability, reverse-once, and audit are inherited.
- Balances always derived (Σ lines); the trial balance never stores totals.
- Chart is company-wide; entries are branch-tagged; trial balance filterable by branch.
- Additive only: one migration chained on `0003_after_sales_loyalty`; existing-model changes are additive
  columns/enum values; 002/003 posting paths are untouched.
