# Implementation Plan: General Ledger & Chart of Accounts

**Branch**: `005-general-ledger` | **Date**: 2026-06-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-general-ledger/spec.md`
**Builds on**: Foundation (`001`) + Sales & Inventory (`002`) + After-Sales Loyalty (`003`) — implemented
and live on MySQL/MariaDB. First feature of the A5Group accounting-parity track (S05 + T01).

## Summary

Turn the Foundation ledger into a full **general ledger** without forking it. The existing flat,
auto-resolved `account` table becomes a **hierarchical, user-defined chart of accounts** by adding
additive columns (`parent_id`, `code`, `name`, `nature`, `is_postable`, `is_system`) — the seven existing
system accounts stay exactly as they are and are simply re-homed as **postable leaves** under standard
group headings. On top of it: **manual journal entries** (dated, described, ≥2 balanced lines on postable
accounts) posted through the *same* immutable `ledger_entry`/`ledger_line` primitives (so they are
reversible-once and audit-logged for free); **opening balances** as one balanced entry against a new
`opening_balance_equity` system account; and a derived **trial balance** (opening + movement + closing per
account, group roll-up, grand totals equal). A new **Accountant** role and an `accounting.*` capability
set gate every operation server-side. Built test-first (Principle X): balance rejection, postable-only
posting, code-hierarchy validation, trial-balance derivation, and reverse-once.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001/002/003
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)` via the shared `MONEY` type
**Testing**: pytest, httpx ASGI client; SQLite in-memory for unit/integration, MySQL for migration check
**Target Platform**: Linux server (same app, same schema); Electron+React back-office client (thin)
**Project Type**: Web service — additive modules under the existing `backend/`
**Performance Goals**: trial-balance generation p95 < 500 ms for a few-thousand-line book; journal post
adds negligible latency over a raw ledger entry
**Constraints**: one ledger only (no parallel GL); balances always derived; journal entries immutable &
reverse-once; postable-leaf-only posting; company-wide chart, branch-tagged entries; back-office only
**Scale/Scope**: low-hundreds of accounts, unbounded append-only journal history, 6→7 roles

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New chart/journal/trial-balance built from spec; A5Group features replicated, **no legacy code/data copied**. ✅ |
| II | Single Source of Truth (API contract) | OpenAPI extended additively under `contracts/`; drift-gated by the existing script. ✅ |
| III | Offline-First Mobile | GL is **back-office only** (Accountant/Admin, never Sales Rep); no offline schema. ✅ |
| IV | Reversibility | Journal entries are immutable; corrections are linked reversing entries; reverse-once via existing `reverses_entry_id` UNIQUE. ✅ |
| V | Multi-Branch & Multi-Warehouse | Chart is company-wide; every entry carries `branch_id`; trial balance filterable by branch. ✅ |
| VI | Treasury & Customer Accounts | Extends the **one** `account`/ledger; system accounts re-homed not redefined; all balances derived (incl. trial balance). ✅ |
| VII | RBAC | New **Accountant** role + `accounting.*` capabilities; deny-by-default; branch scope reused. ✅ |
| VIII | Arabic RTL / EGP | EGP `MONEY` reused; account names & بيان are data; presentation client-side. ✅ |
| IX | Reporting first-class | Trial balance reads the ledger source of truth; no shadow totals. ✅ |
| X | Test-First (NON-NEGOTIABLE) | Balance rejection, postable-only, code-hierarchy, trial-balance derivation, reverse-once get failing tests first. ✅ |
| XI | No Negative Stock | N/A — GL is money-only, touches no stock. ✅ |

**Gate result: PASS.** Deliberate decisions recorded in Complexity Tracking (justified, not violations).

## Project Structure

### Documentation (this feature)

```text
specs/005-general-ledger/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/openapi.yaml      # this feature's endpoints (chart, journals, opening balances, trial balance)
├── checklists/requirements.md  # spec quality (done)
└── tasks.md                    # /speckit.tasks output (NOT created here)
```

### Source Code (additive to the existing backend/)

```text
backend/src/
├── models/
│   ├── ledger.py          # EXTEND Account: +parent_id, code, name, nature, is_postable, is_system;
│   │                      #   +AccountNature enum; +opening_balance_equity AccountType;
│   │                      #   +LedgerLine.statement; +LedgerEntry.entry_date (accounting date)
│   └── role.py            # EXTEND RoleName (+accountant)
├── auth/
│   └── rbac.py            # EXTEND: accounting.* caps; grant to accountant (+ system_admin)
├── services/
│   ├── chart_service.py        # create/update/deactivate accounts; code-hierarchy & postable rules
│   ├── journal_service.py      # post_entry() (balanced, postable-only) -> ledger; reverse_entry()
│   ├── opening_balance_service.py  # post opening balances vs opening_balance_equity
│   ├── trial_balance_service.py    # derive opening/movement/closing, group roll-up, totals
│   └── account_resolver.py     # EXTEND NORMAL_SIDE (+opening_balance_equity); chart-aware helpers
├── api/
│   └── accounting.py      # routers: /accounts (chart tree), /journal-entries, /opening-balances, /trial-balance
├── migrations/versions/
│   └── 0004_general_ledger.py  # additive: ALTER account (+columns, +enum value), seed group headings &
│                               #   re-home system accounts, seed opening_balance_equity, seed accountant role
└── tests/
    ├── unit/
    │   ├── test_journal_balanced.py        # Σdebit≠Σcredit rejected
    │   ├── test_postable_only.py           # posting to a group node rejected
    │   ├── test_account_code_hierarchy.py  # child code prefixed by parent; unique
    │   ├── test_trial_balance_derivation.py# per-account = Σ lines; grand totals equal
    │   └── test_journal_reverse_once.py     # reversing entry; second reversal rejected
    ├── integration/
    │   ├── test_chart_crud.py              # build tree, deactivate-not-delete, system accounts present
    │   ├── test_journal_post_api.py        # post via API, branch scope, audit logged
    │   ├── test_opening_balances.py        # balanced vs equity; included in balances
    │   └── test_trial_balance_report.py    # opening+movement+closing, group roll-up, branch filter
    └── contract/
        └── test_accounting_contract.py     # extended OpenAPI shape + drift gate
```

**Structure Decision**: One app, one schema, one Alembic history. Additive only: `Account` gains nullable
chart columns (existing rows backfilled in-migration), a single migration with down-revision
`0003_after_sales_loyalty`, the `AccountType` enum extended in place (+`opening_balance_equity`), a new
`AccountNature` enum, the `RoleName` enum extended (+`accountant`), and new services/routers. **No new
ledger** — journals and opening balances are ordinary `ledger_entry`/`ledger_line` rows, so immutability,
reverse-once, and audit logging are inherited, not re-implemented.

## Complexity Tracking

> Deliberate structure beyond the simplest approach — justified, not constitution violations.

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| **Extend `Account` into the chart** (add `parent_id`/`code`/`name`/`nature`/`is_postable`/`is_system`) rather than a new `chart_account` table mapped 1:1 to accounts | Principle VI mandates ONE ledger and ONE account model; the seven system accounts must appear in the tree and keep working unchanged | A parallel chart table needs a join + sync on every post and two sources of truth for "what is an account" — exactly the dual-ledger split the constitution forbids |
| Re-home system accounts under **seeded group headings** and keep `account_type`/`owner_ref` alongside the new `nature`/`is_postable` | 002/003 resolve accounts by `account_type` + `owner_ref`; that path must not change while the new chart columns drive the human-facing tree | Repurposing `account_type` as the chart classification would break `account_resolver` singletons and the customer/custody owner refs |
| **Opening balances as a journal entry** vs the `opening_balance_equity` system account (no special storage) | Keeps balances ledger-derived (Principle VI); openings then flow through the trial balance like any movement | A dedicated `opening_balance` table is a second balance store that the trial balance would have to special-case and could drift |
| New **Accountant role** + `accounting.*` capability set (not folded into `_BRANCH_FULL`) | Clarified decision; managing the chart and posting journals is a distinct duty that must be grantable without branch-admin powers | Granting via `branch_manager` couples accounting authority to branch administration and can't be assigned to a dedicated accountant |

> Note: `is_system` marks the seven resolver-owned accounts + `opening_balance_equity` so the chart UI
> can show them read-only (renamable, never deletable, never re-parented out of a valid nature) — they are
> postable leaves the automated flows depend on.
