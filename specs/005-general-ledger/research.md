# Phase 0 Research: General Ledger & Chart of Accounts

All "NEEDS CLARIFICATION" items from the spec were resolved in the 2026-06-28 clarification session
(new Accountant role; company-wide chart with branch-tagged entries; segmented numeric codes). The
research below records the design decisions that close the remaining technical unknowns.

## R1 — Extend `Account` vs. a separate chart table

**Decision**: Extend the Foundation `account` table with additive, nullable columns
(`parent_id`, `code`, `name`, `nature`, `is_postable`, `is_system`) and backfill existing rows in the
migration. Keep `account_type`/`owner_ref`/`normal_side` untouched.

**Rationale**: Constitution VI mandates a single ledger and account model; the seven system accounts must
appear in the chart and keep being resolved by `account_resolver` (by `account_type` + `owner_ref`).
Adding columns gives a chart over the *same* rows — no join, no sync, no second source of truth.

**Alternatives rejected**: A parallel `chart_account` table 1:1 with `account` (extra join + sync on every
post; "what is an account" split across two tables) — the dual-store pattern the constitution forbids.

## R2 — Account nature vs. existing `account_type`

**Decision**: Add an `AccountNature` enum (`asset`, `liability`, `equity`, `income`, `expense`) as the
human-facing classification that drives the tree and the trial-balance sign. `account_type` (the
machine/resolver discriminator) stays as-is. `normal_side` continues to be the posting side and is
derived from nature for user accounts (asset/expense → debit; liability/equity/income → credit),
matching the existing `NORMAL_SIDE` table for the seven system accounts.

**Rationale**: `account_type` carries owner semantics (custody/customer/treasury) that the resolver
needs; nature is the accounting classification A5Group's `acc_main` expresses. They are orthogonal — a
`customer_receivable` *is* an `asset`. Keeping both avoids breaking 002/003 while giving the chart its
classification.

**Mapping of the seven system accounts to nature/group**:

| account_type | nature | group heading (seeded) |
|---|---|---|
| treasury | asset | Current Assets |
| custody | asset | Current Assets |
| customer_receivable | asset | Receivables |
| supplier_payable | liability | Payables |
| sales_revenue | income | Revenue |
| purchases_expense | expense | Cost & Expenses |
| loyalty_expense | expense | Cost & Expenses |
| opening_balance_equity *(new)* | equity | Equity |

## R3 — Segmented numeric code scheme

**Decision**: Codes are dot-segmented numeric strings (`1`, `1.01`, `1.01.001`). Validation rule: a
child's `code` MUST start with its parent's `code + "."`; root codes have no dot. Codes are unique
(DB unique index). Segment widths are not fixed by the system (recommended 1/2/3 digits) — only the
prefix-of-parent rule is enforced, so depth stays unbounded.

**Rationale**: Matches conventional charts and A5Group's hierarchical `acc` codes; the prefix rule makes
the code self-describe the hierarchy and lets the trial balance roll up by `code LIKE 'parent.%'` as a
fast path (with `parent_id` as the authoritative structure).

**Alternatives rejected**: Free unique text (no hierarchy guarantee); fixed-width segmented scheme (rigid
depth, awkward for unbalanced trees).

## R4 — Journal entries on the existing ledger primitives

**Decision**: A manual journal entry is posted as one `ledger_entry` (`entry_type="journal"`,
`description`, `actor_user_id`, `branch_id`, `entry_date`) with ≥2 `ledger_line`s. `journal_service`
reuses Foundation `ledger_service.post_entry()` (which already enforces ≥2 lines, Σdebit=Σcredit, positive
amounts) and adds the postable-leaf-only + active check before calling it. Reversal reuses Foundation
`ledger_service.reverse_entry()` (UNIQUE `reverses_entry_id` → reverse-once; entry_type="reversal").

**Rationale**: Immutability guards and reverse-once already exist on `ledger_entry`/`ledger_line` and in
`ledger_service`. Reusing them means journals get those guarantees for free and a journal is
indistinguishable from any other ledger event in reports (one ledger, Principle VI/IX).

**Sub-decisions**:
- **Per-line بيان**: add a nullable `statement VARCHAR(255)` column on `ledger_line` (additive; 002/003
  posts leave it NULL) since the existing line has no free-text field.
- **Business date (analysis finding A)**: `ledger_entry` currently has only `created_at` (posting
  timestamp). Journals — and especially **back-dated opening balances** — need a user-chosen
  **accounting date**. Add a nullable `entry_date DATE` column (additive; legacy posts fall back to
  `created_at::date`). The trial balance filters by `entry_date`, NOT `created_at`.
- **Audit (analysis finding B)**: `ledger_service.post_entry` does NOT auto-audit; `journal_service` /
  `opening_balance_service` MUST call `audit_service.record(...)` explicitly (FR-010), as 002/003 services do.

## R5 — Opening balances

**Decision**: Seed an `opening_balance_equity` system account (nature=equity, postable, is_system). Opening
balances are entered as a single balanced journal entry (`entry_type="opening_balance"`): each account's
opening amount on its normal side, with the offsetting total on `opening_balance_equity`. They then appear
in the trial balance's opening column for any range starting after the opening date.

**Rationale**: No second balance store; openings are ordinary ledger movement, so every downstream report
sees them without special-casing.

## R6 — Trial balance derivation

**Decision**: `trial_balance_service` computes, per postable account, for a date range `[from, to]`:
- **opening** = signed Σ of lines with `entry.entry_date < from`
- **period debit / period credit** = Σ amounts by direction for lines in `[from, to]`
- **closing** = opening + (period debit − period credit), signed to the account's normal side

Group nodes roll up the sum of their descendant leaves (by `parent_id` subtree). Grand-total debit and
credit over all leaves are returned and MUST be equal. SQLite (tests) and MySQL (prod) both supported via
plain SQLAlchemy aggregation; no DB-specific SQL.

**Rationale**: Pure derivation from `ledger_line` keeps Principle IX intact; no stored totals to drift.
Branch filter = additional `entry.branch_id` predicate.

## R7 — RBAC: Accountant role + capabilities

**Decision**: Add `RoleName.accountant`. New capabilities: `accounting.chart.read`,
`accounting.chart.write`, `accounting.journal.post`, `accounting.journal.reverse`,
`accounting.trial_balance.read`. Granted to `accountant` and `system_admin`. Reuse the existing
`CAP_LEDGER_READ` for read overlap where natural. Branch scope reuses the existing scope predicates in
`dependencies.py` (a branch-scoped accountant posts/reads only their `branch_id`; system_admin all).

**Rationale**: Mirrors the additive pattern used by 002 (`_SI_BY_ROLE`) and 003 (loyalty caps). Keeps
accounting authority separable from branch administration.

## R8 — Migration shape

**Decision**: One additive migration `0004_general_ledger.py` (down-revision `0003_after_sales_loyalty`):
1. `ALTER TABLE account` add the new columns; `ALTER` the `account_type` enum to add
   `opening_balance_equity`; add unique index on `account.code`.
2. `ALTER TABLE ledger_line` add `statement` column.
3. `ALTER TABLE ledger_entry` add `entry_date` (DATE, nullable) column.
4. `ALTER TABLE role` enum add `accountant` (MySQL) and seed the `accountant` role row.
5. Data seed: create the standard group headings, set `nature`/`is_postable`/`is_system` and re-home the
   seven existing system accounts under their groups; create `opening_balance_equity`; assign codes.
6. No table dropped or redefined; no money data backfilled (openings are entered by the user later).

**Rationale**: Consistent with 0002/0003 additive style (enum ALTER + create/seed + immutability already
present on ledger). Idempotent guards for dialect (MySQL/MariaDB enum ALTER; SQLite skips enum ALTER).
