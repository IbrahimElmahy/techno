# Implementation Plan: Cost Centers (Analytical Dimension)

**Branch**: `006-cost-centers-optional` | **Date**: 2026-06-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/006-cost-centers-optional/spec.md`
**Builds on**: Foundation (`001`) + General Ledger (`005`) — implemented and tested. Second unit of the
A5Group accounting-parity track (S03), per the approved Review build order.

## Summary

Add an **optional cost-center dimension** to the one ledger without touching how money is recorded. A new
`cost_center` master table (code, name, parent, active — hierarchical like the chart) holds the dimension
values; the Foundation `ledger_line` gains a single nullable `cost_center_id`. The 005 `journal_service`
accepts an optional cost center per line (validated active), `ledger_service.reverse_entry` copies the
cost center onto each mirror line, and `trial_balance_service` accepts an optional `cost_center_id` filter.
A small `cost_center_service` enforces the master rules (unique code, child-under-parent, deactivate-not-
delete). Management + analysis reuse the **005 `accounting.*` capabilities** — no new role. Existing
001/002/003 postings and opening balances post a NULL cost center (no regression). Built test-first
(Principle X) for the dimension's optionality, deactivation, reversal-copy, and filtered aggregation.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001–005
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)` via shared `MONEY`
**Testing**: pytest, httpx ASGI client; SQLite in-memory for unit/integration, MySQL for migration check
**Target Platform**: Linux server (same app, same schema); Electron+React back-office client (thin)
**Project Type**: Web service — additive modules under the existing `backend/`
**Performance Goals**: cost-center filter adds a single predicate; trial balance stays p95 < 500 ms
**Constraints**: one ledger; dimension optional & nullable; figures derived; reuse 005 caps;
no behavioural change when unfiltered/untagged
**Scale/Scope**: low-hundreds of cost centers; unbounded tagged lines; no new role

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New master + dimension from spec; A5Group feature, no legacy code/data. ✅ |
| II | Single Source of Truth (API contract) | OpenAPI extended additively under `contracts/`; drift-gated. ✅ |
| III | Offline-First Mobile | Back-office only (Accountant/Admin); no offline schema. ✅ |
| IV | Reversibility | Reversal copies the cost center; master deactivated not deleted. ✅ |
| V | Multi-Branch & Multi-Warehouse | Orthogonal to branch; cost center is an independent axis. ✅ |
| VI | Treasury & Customer Accounts | Dimension is a **line attribute** on the one ledger; figures derived, no second store. ✅ |
| VII | RBAC | Reuses 005 `accounting.*` (deny-by-default); no new role. ✅ |
| VIII | Arabic RTL / EGP | Unaffected; names are data. ✅ |
| IX | Reporting first-class | Trial balance gains an optional cost-center axis over the same source of truth. ✅ |
| X | Test-First (NON-NEGOTIABLE) | Optionality, deactivation, reversal-copy, filtered aggregation get failing tests first. ✅ |
| XI | No Negative Stock | N/A — money-only dimension. ✅ |

**Gate result: PASS.** One deliberate decision recorded in Complexity Tracking (justified).

## Project Structure

### Documentation (this feature)

```text
specs/006-cost-centers-optional/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/openapi.yaml      # cost-center CRUD + the cost_center filter/field additions
├── checklists/requirements.md  # spec quality (done)
└── tasks.md                    # /speckit.tasks output (NOT created here)
```

### Source Code (additive to the existing backend/)

```text
backend/src/
├── models/
│   ├── cost_center.py     # NEW: CostCenter (code, name, parent_id, active)
│   └── ledger.py          # EXTEND LedgerLine: +cost_center_id (nullable FK)
├── services/
│   ├── cost_center_service.py  # NEW: create/update/deactivate; unique-code, child-under-parent rules
│   ├── ledger_service.py       # EXTEND: LineInput +cost_center_id; reverse copies it
│   ├── journal_service.py      # EXTEND: validate active cost center per line; pass through
│   └── trial_balance_service.py# EXTEND: optional cost_center_id filter
├── api/
│   ├── cost_centers.py    # NEW router: /cost-centers CRUD (tree/flat)
│   └── accounting.py      # EXTEND: journal line cost_center_id in/out; trial-balance & journal filters
├── models/__init__.py     # register CostCenter
├── migrations/versions/
│   └── 0005_cost_centers.py    # additive: create cost_center table; ALTER ledger_line +cost_center_id
└── tests/
    ├── unit/
    │   ├── test_cost_center_master.py      # unique code; child-under-parent; deactivate-not-delete
    │   ├── test_journal_cost_center.py     # optional tag; deactivated/unknown rejected; balance unaffected
    │   └── test_cost_center_reversal_copy.py# reversal mirrors the cost center
    ├── integration/
    │   ├── test_cost_centers_api.py        # CRUD + RBAC (reuses accounting caps)
    │   └── test_trial_balance_cost_center.py# filtered aggregation; unfiltered unchanged
    └── contract/
        └── test_cost_centers_contract.py    # new endpoints/fields in OpenAPI + drift gate
```

**Structure Decision**: One app, one schema, one Alembic history. Additive only: a new `cost_center`
table, one nullable `ledger_line.cost_center_id` column, a new service + router, and small extensions to
the three 005 services. Migration `0005_cost_centers` chains on `0004_general_ledger`. No table dropped
or redefined; 001/002/003 posting paths are untouched (they pass `cost_center_id=None`).

## Complexity Tracking

> Deliberate structure beyond the simplest approach — justified, not constitution violations.

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Cost center as a **nullable column on `ledger_line`** (not a join table or tag entity) | The dimension is 1:1 per line and must be filterable cheaply; A5Group asks one cost center per line | A `line_tag` join table allows many tags per line (not needed), adds a join to every filtered report, and complicates the immutable-line model for zero benefit |
| **Hierarchical** cost-center master (parent_id) rather than flat | Clarified; mirrors the chart of accounts and A5Group grouping, and lets reports roll up later | A flat list blocks departmental roll-up the Reporting layer will need, forcing a later breaking change |
| Reuse **005 `accounting.*`** caps instead of a new capability/role | Cost centers are an accounting concern managed by the same Accountant; avoids RBAC sprawl | A dedicated `cost_center.*` capability multiplies grants with no distinct authority boundary |

> Note: per-cost-center balancing holds only for fully-tagged entries; partial tagging is permitted by
> design (A5Group behaviour). The filtered trial balance surfaces inequality rather than forbidding it,
> keeping the dimension optional and non-intrusive.
