# Phase 1 Data Model: General Ledger & Chart of Accounts

Additive to the Foundation ledger. **No new ledger.** Journals and opening balances are ordinary
`ledger_entry`/`ledger_line` rows; only the `account` table grows chart columns, `ledger_line` gains a
بيان field, and two enums extend.

## Extended entity: `account` (Foundation, +chart columns)

| Column | Type | Notes |
|---|---|---|
| id | BigIntPK | unchanged |
| account_type | Enum(AccountType) | unchanged; **+`opening_balance_equity`** value added |
| owner_ref | BigInteger NULL | unchanged (custody/customer id; NULL for singletons) |
| normal_side | Enum(Direction) | unchanged; for user accounts derived from `nature` |
| active | bool | unchanged; deactivation flag (never hard-delete a used/parent account) |
| **parent_id** | BigInteger NULL FK→account.id | chart hierarchy; NULL = root group |
| **code** | String(40) | segmented numeric (`1.01.001`); **UNIQUE**; child prefixed by parent code |
| **name** | String(160) | account name (Arabic data) |
| **nature** | Enum(AccountNature) NULL | asset/liability/equity/income/expense; NULL only transiently in migration before backfill |
| **is_postable** | bool, default True | leaf accepts journal lines; group (False) aggregates only |
| **is_system** | bool, default False | True for the 7 resolver accounts + opening_balance_equity (read-mostly, never deletable) |

**Rules**
- A group (`is_postable=False`) MUST NOT receive ledger lines (enforced in `journal_service`).
- `code` UNIQUE; child `code` MUST start with `parent.code + "."`; root has no dot.
- An account with children OR posted lines MUST NOT be hard-deleted → set `active=False`.
- A `is_system` account MAY be renamed but NOT deleted, NOT made a group if it has lines, NOT re-parented
  to a different nature.
- `nature → normal_side`: asset/expense ⇒ debit; liability/equity/income ⇒ credit (consistent with the
  existing `NORMAL_SIDE` for the seven system accounts).

### New enum: `AccountNature`
`asset | liability | equity | income | expense`

### Extended enum: `AccountType`
…existing seven… **+ `opening_balance_equity`** (nature=equity, normal_side=credit, singleton, is_system).

## Extended entity: `ledger_line` (Foundation, +statement)

| Column | Type | Notes |
|---|---|---|
| … existing … | | unchanged |
| **statement** | String(255) NULL | per-line بيان; set by journal entries, NULL for 002/003 posts |

## Extended entity: `ledger_entry` (Foundation, +entry_date)

A manual journal entry **is** a `ledger_entry`:

| Column | Type | Notes |
|---|---|---|
| … existing … | | unchanged |
| **entry_date** | Date NULL | **accounting/business date** (user-chosen); drives trial-balance date ranges. NULL for legacy 001/002/003 posts (which fall back to `created_at::date`). REQUIRED for journals & opening balances. |

- `entry_type = "journal"` (manual) / `"opening_balance"` (openings) / `"reversal"` (a journal reversal,
  set by the reused Foundation `reverse_entry`)
- `description` = entry-level narration
- `actor_user_id`, `branch_id` = who/where (branch_id REQUIRED for journals)
- `reverses_entry_id` (UNIQUE) = set on the mirror reversal → **reverse-once**
- `entry_date` = the date used by the trial balance (NOT `created_at`, which is the posting timestamp —
  opening balances are intentionally back-dated, so the two differ)
- `lines` = ≥2 `ledger_line`s, Σdebit = Σcredit, each on a **postable** account

No new journal table — a "journal entry" is a view/DTO over `ledger_entry` + its lines.

> **Audit (FR-010)**: Foundation `ledger_service.post_entry` does **not** auto-write audit; `journal_service`
> / `opening_balance_service` MUST call `audit_service.record(...)` explicitly after posting/reversing.

## Extended entity: `role`

### Extended enum: `RoleName`
…existing six… **+ `accountant`**. One seeded `role` row.

## Derived view (not stored): Trial Balance

Per postable account over `[from, to]` (optional `branch_id`):
- `opening` = signed Σ(lines where entry.entry_date < from)
- `period_debit`, `period_credit` = Σ amount by direction in range
- `closing` = opening + (period_debit − period_credit) on normal side
- group nodes = Σ of descendant leaves (subtree by `parent_id`)
- response includes `grand_total_debit == grand_total_credit` (invariant)

Computed in `trial_balance_service` from `ledger_line`/`ledger_entry`; never persisted.

## Entity relationship (additive view)

```text
account (1) ──< account (parent_id)        # self-referential chart tree
account (1) ──< ledger_line (account_id)   # postable leaves only
ledger_entry (1) ──< ledger_line           # ≥2, balanced
ledger_entry (0..1) ── ledger_entry (reverses_entry_id, UNIQUE)   # reverse-once
role (accountant) ── user                  # via existing user-role link
opening_balance_equity (account) ── balances opening_balance entries
```

## Validation summary (enforced server-side, test-first)

| Rule | Where | Test |
|---|---|---|
| Σdebit = Σcredit, ≥2 lines | journal_service | test_journal_balanced |
| line only on postable leaf | journal_service | test_postable_only |
| child code prefixed by parent; code unique | chart_service | test_account_code_hierarchy |
| no hard-delete of used/parent/system account | chart_service | test_chart_crud |
| reverse-once | journal_service (reuses reverses_entry_id) | test_journal_reverse_once |
| trial balance = Σ lines; grand totals equal | trial_balance_service | test_trial_balance_derivation |
| branch scope on post/read | api + dependencies scope | test_journal_post_api |
