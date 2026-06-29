# Phase 0 Research: Foundation

All Technical Context unknowns are resolved by the constitution (v1.1.1, stack fixed) and the
clarified spec. This document records the design decisions that shape Phase 1, with rationale and
rejected alternatives.

## R1. Double-entry ledger schema shape

- **Decision**: Three tables — `account` (the postable buckets: the single treasury account, one per
  custody, one per customer receivable), `ledger_entry` (the immutable event header: timestamp,
  actor, type, description, optional `reverses_entry_id`), and `ledger_line` (each debit/credit leg:
  `entry_id`, `account_id`, `direction` debit|credit, `amount` DECIMAL(18,2)). An entry has ≥2 lines
  and MUST satisfy Σdebit = Σcredit.
- **Rationale**: Header/lines is the canonical double-entry model; it guarantees balance per event,
  supports multi-leg postings (a credit sale later touches receivable + revenue + custody in one
  event), and keeps every balance derivable as `Σ lines for account`.
- **Alternatives considered**: (a) Flat signed-amount transaction table — cannot enforce balanced
  entries or multi-leg events; (b) per-domain ledgers — violates "one shared ledger all domains post
  to" (FR-026).

## R2. Immutability & reversal-linkage enforcement

- **Decision**: Posted entries/lines are append-only. The service layer exposes only `post_entry()`
  and `reverse_entry(original)`; there is no update/delete path. `reverse_entry` creates a new entry
  whose lines mirror the original (debits↔credits swapped) and sets `reverses_entry_id`. A DB
  trigger (or SQLAlchemy event guard) rejects UPDATE/DELETE on `ledger_entry`/`ledger_line`. An entry
  may be reversed at most once (unique constraint on `reverses_entry_id`).
- **Rationale**: Principle IV requires corrections as new linked entries, never mutation. Enforcing at
  both service and DB level makes immutability structural, not conventional.
- **Alternatives considered**: Soft-delete flags — rejected; they mutate history and break audit.

## R3. Balance derivation (no stored standalone balances)

- **Decision**: `balance_of(account_id)` = `SUM(CASE direction WHEN debit THEN +amount ELSE -amount END)`
  over `ledger_line` (sign convention per account class). No balance column on `account`, `custody`,
  `treasury`, or `customer_account`. Indexed on `ledger_line(account_id)`.
- **Rationale**: FR-026 / SC-004 — every balance MUST equal the sum of its posted entries.
- **Alternatives considered**: Stored running balance — rejected (drift risk, SC-004 violation). A
  rebuildable cache is deferred (see plan Complexity note) and would remain a projection, not source.

## R4. RBAC model & scope attachment

- **Decision**: Six roles (System Admin, Branch Manager, Purchasing Manager, Sales Manager,
  After-Sales Staff, Sales Rep). Permissions are named capabilities (e.g., `branch.write`,
  `customer.reassign`, `ledger.post`). A static role→permission map resolves capabilities;
  **deny-by-default** (absence = forbidden). The acting user carries `branch_id` (for branch-scoped
  roles) and `rep_id` (for Sales Rep). Every endpoint declares the capability it needs plus a scope
  predicate (`same_branch`, `own_rep`, or `any`) evaluated server-side via a FastAPI dependency.
- **Rationale**: Principle VII + FR-002/010/011. Centralized resolution prevents per-endpoint drift
  and is uniformly testable.
- **Alternatives considered**: Per-row ACLs — over-engineered for a fixed six-role model; inline
  handler checks — error-prone, rejected (Complexity Tracking).

## R5. Authentication & sessions

- **Decision**: Login with admin-assigned unique `username` + password (bcrypt via passlib). Issue a
  signed JWT access token (short TTL, e.g., 30 min) carrying `user_id`, `role`, `branch_id`,
  `rep_id`, `active`. Stateless verification per request; failed/successful logins are audited.
  Refresh-token strategy and MFA are deferred (spec Assumptions).
- **Rationale**: FR-001/004; matches clarified login-ID decision. JWT keeps scope claims on the token
  for cheap per-request authorization.
- **Alternatives considered**: Server-side session store — heavier; not needed at this scale.
- **Note**: Token still re-checks `active` and current scope server-side so a removed branch
  assignment denies mid-session (spec Edge Case).

## R6. Money type & currency

- **Decision**: All monetary amounts `DECIMAL(18,2)`, currency implicitly EGP (no currency column;
  Principle VIII single-currency). Arithmetic via Python `Decimal`; never float.
- **Rationale**: Exact financial arithmetic; single currency removes FX complexity.

## R7. Customer identity, ownership & reassignment

- **Decision**: `customer.code` is a system-generated unique stable identifier (e.g., zero-padded
  sequence or `CUST-{n}`). Ownership is exactly one `rep_id` + one `territory_id` at a time, stored on
  the customer row. Reassignment updates those FKs only; the linked `customer_account` and its ledger
  history are untouched (history stays attributed via the actor/rep recorded on each past entry). Phone
  is stored, not unique; a create/update warns on duplicate phone but allows it.
- **Rationale**: FR-018a/020/020a; SC: reassignment keeps same account/balance, past entries stay with
  the original rep.
- **Alternatives considered**: Phone as unique key — rejected (field reality: shared/absent phones);
  ownership history table — not needed at foundation since ledger entries already carry actor/rep.

## R8. Audit log

- **Decision**: `audit_log_entry(actor_user_id, action, entity_type, entity_id, before_json,
  after_json, created_at)` written for: successful/failed logins, role/permission changes, customer
  reassignment, activations/deactivations, and ledger postings/reversals. Reads are not logged.
  Append-only.
- **Rationale**: FR-031 / SC-007.
- **Alternatives considered**: Full CRUD/read auditing — rejected per clarification (Option B scope).

## R9. Migrations

- **Decision**: Alembic, models-as-source-of-truth with `--autogenerate`, reviewed by hand. One
  baseline migration creating all foundation tables + the immutability trigger; thereafter one
  migration per schema change. No data backfill (legacy migration is a separate deployment concern,
  Principle I).
- **Rationale**: Standard FastAPI+SQLAlchemy practice; keeps schema reproducible and greenfield.

## R10. Out-of-scope boundaries (no over-commit)

- **Decision**: No `product`, `invoice`, `stock_movement`, `coupon`, or `employee` tables. The shared
  catalog is referenced only conceptually; warehouses/custodies exist as locations without stock rows.
  Customer `loyalty_points_balance` is *not* added now — only the account/ownership structure that
  later loyalty will hang off. Loyalty deferral is total: no loyalty column or table is added by
  Foundation; the loyalty-point balance and point-transfer mechanics are owned by the After-Sales
  spec (FR-022, constitution v1.1.2).
- **Rationale**: Principle/Domain phasing + spec Out-of-Scope; deferred work must not constrain its
  later design.
