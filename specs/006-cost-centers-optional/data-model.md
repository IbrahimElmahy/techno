# Phase 1 Data Model: Cost Centers (Analytical Dimension)

Additive to the 005 ledger. **One new master table** + **one nullable column** on `ledger_line`. No new
ledger, no stored balances; cost-center figures are derived by filtering lines.

## New entity: `cost_center`

| Column | Type | Notes |
|---|---|---|
| id | BigIntPK | |
| code | String(40) | **UNIQUE** (free string; segmented convention recommended, not enforced) |
| name | String(160) | Arabic name (data) |
| parent_id | BigInteger NULL FK→cost_center.id | hierarchy; NULL = root |
| active | bool, default True | deactivation flag (never hard-delete a used/parent center) |

**Rules**
- `code` UNIQUE; `parent_id` (if set) must reference an existing cost center.
- A center with tagged ledger lines OR active children MUST NOT be hard-deleted → set `active=False`.
- Only an `active` center may be attached to a new ledger line.
- Not a ledger account; never balance-bearing on its own.

## Extended entity: `ledger_line` (Foundation/005, +cost_center_id)

| Column | Type | Notes |
|---|---|---|
| … existing … | | unchanged |
| **cost_center_id** | BigInteger NULL FK→cost_center.id | the tag (optional). NULL for 001/002/003/opening posts and untagged journal lines. Set at insert; never mutated (immutable line). |

## Reused unchanged

`ledger_entry`, `Account`, `Branch`, `Role`, audit log, and the 005 `journal_service` /
`trial_balance_service` (extended additively, not redefined).

## Service surface (additive)

- `cost_center_service.create_account`-style: `create(code, name, parent_id)`, `update(id, name, active)`,
  `deactivate(id)` — mirrors `chart_service` rules.
- `ledger_service.LineInput` gains `cost_center_id: int | None = None`; `post_entry` persists it;
  `reverse_entry` copies it onto mirror lines.
- `journal_service.JournalLineInput` gains `cost_center_id`; `post_entry` validates active before posting.
- `trial_balance_service.trial_balance(..., cost_center_id: int | None = None)` — optional filter.

## Derived views (not stored)

- **Cost-center activity** = filter `ledger_line.cost_center_id == X` and aggregate exactly like the
  trial balance. No stored per-cost-center balance.

## Validation summary (enforced server-side, test-first)

| Rule | Where | Test |
|---|---|---|
| unique code; child under existing parent | cost_center_service | test_cost_center_master |
| no hard-delete of used/parent center | cost_center_service | test_cost_center_master |
| optional tag; balance unaffected | journal_service | test_journal_cost_center |
| deactivated/unknown center rejected on a line | journal_service | test_journal_cost_center |
| reversal copies the cost center | ledger_service | test_cost_center_reversal_copy |
| filtered trial balance aggregates only that center; unfiltered unchanged | trial_balance_service | test_trial_balance_cost_center |
| management/analysis gated by 005 accounting caps | api | test_cost_centers_api |

## Entity relationship (additive view)

```text
cost_center (1) ──< cost_center (parent_id)     # self-referential hierarchy
cost_center (1) ──< ledger_line (cost_center_id) # optional tag on lines
ledger_entry (1) ──< ledger_line                 # unchanged
```
