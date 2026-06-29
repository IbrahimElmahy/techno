# Phase 1 Data Model: Foundation

Conventions: MySQL/MariaDB InnoDB, `utf8mb4`. PKs are `BIGINT` surrogate `id` unless noted. Money is
`DECIMAL(18,2)` (EGP). Timestamps are UTC `DATETIME(6)`. FKs are `ON DELETE RESTRICT` (no destructive
deletes; deactivate instead). "Derived" fields are computed on read — **never stored**.

The ledger is the core; it is defined first.

---

## 1. Ledger (core — immutable double-entry)

### `account`
The postable bucket. Exactly one row per balance-bearing thing.

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| account_type | ENUM('treasury','custody','customer_receivable') | discriminator |
| owner_ref | BIGINT NULL | FK to custody.id or customer_account.id depending on type; NULL for the singleton treasury |
| normal_side | ENUM('debit','credit') | sign convention for balance derivation |
| active | BOOL default TRUE | |

- Uniqueness: exactly one `treasury` account (enforced by app + unique partial index pattern).
- Balance (derived): `Σ(line.amount · (+1 if line.direction=normal_side else −1))`.

### `ledger_entry` (header — immutable)

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| entry_type | VARCHAR(40) | e.g., `opening`, `cash_handover`, `adjustment`, `reversal` |
| description | VARCHAR(255) | |
| actor_user_id | BIGINT FK→user.id | who posted (attribution) |
| rep_id | BIGINT NULL FK→user.id | originating rep if applicable (attribution survives reassignment) |
| branch_id | BIGINT NULL FK→branch.id | scope tag for isolation/reporting |
| reverses_entry_id | BIGINT NULL FK→ledger_entry.id, UNIQUE | set only on reversal entries |
| created_at | DATETIME(6) | |

- **Immutable**: no UPDATE/DELETE (DB trigger + service guard).
- **Reversed at most once**: `UNIQUE(reverses_entry_id)`.
- Invariant: an entry has ≥2 lines and `Σ debit = Σ credit`.

### `ledger_line` (legs — immutable)

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| entry_id | BIGINT FK→ledger_entry.id | |
| account_id | BIGINT FK→account.id | |
| direction | ENUM('debit','credit') | |
| amount | DECIMAL(18,2) | > 0 |

- Index: `(account_id)` for balance derivation; `(entry_id)`.

**State**: entries are append-only; "correction" = a new `reversal` entry whose lines mirror the
original (debit↔credit swapped) referencing it via `reverses_entry_id`.

---

## 2. Identity & Access

### `user`

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| username | VARCHAR(64) UNIQUE | admin-assigned stable login-ID (FR-001) |
| password_hash | VARCHAR(255) | bcrypt |
| role_id | BIGINT FK→role.id | exactly one role (Assumption) |
| branch_id | BIGINT NULL FK→branch.id | required for branch-scoped roles |
| territory_id | BIGINT NULL FK→territory.id | required for Sales Rep |
| full_name | VARCHAR(120) | |
| active | BOOL default TRUE | deactivation preserves history (FR-003) |
| created_at | DATETIME(6) | |

- A Sales Rep MUST have `branch_id` + `territory_id`; a Branch/Purchasing/Sales Manager MUST have
  `branch_id`; System Admin has neither (global). Validated in service + check constraint where feasible.

### `role`

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| name | ENUM(6 roles) UNIQUE | System Admin, Branch Manager, Purchasing Manager, Sales Manager, After-Sales Staff, Sales Rep |

- Role→permission mapping is **code-defined** (static map in `auth/rbac.py`), not a table — the six
  roles are fixed by the constitution. Deny-by-default: a capability absent from the map is forbidden.

---

## 3. Organization

### `governorate`

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| name | VARCHAR(80) UNIQUE | Egyptian governorate |

### `head_office` / `branch`

`head_office`: single row (id, name). `branch`:

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| name | VARCHAR(120) | |
| governorate_id | BIGINT FK→governorate.id | (FR-012) |
| is_head_office | BOOL default FALSE | |
| active | BOOL default TRUE | |

### `territory`

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| name | VARCHAR(120) | |
| branch_id | BIGINT FK→branch.id | each territory within exactly one branch (FR-014) |
| active | BOOL default TRUE | |

---

## 4. Warehouses & Custodies

### `warehouse`

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| name | VARCHAR(120) | |
| warehouse_type | ENUM('central','branch') | |
| branch_id | BIGINT NULL FK→branch.id | NULL for central; required for branch warehouses (FR-015/017) |
| active | BOOL default TRUE | |

- References the shared product catalog only conceptually — **no product/stock rows** here.

### `custody` (عهدة)

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| holder_type | ENUM('rep','warehouse') | |
| rep_id | BIGINT NULL FK→user.id | set when holder_type='rep' |
| warehouse_id | BIGINT NULL FK→warehouse.id | set when holder_type='warehouse' |
| active | BOOL default TRUE | |

- **Exactly one custody per holder** (FR-025): `UNIQUE(rep_id)` and `UNIQUE(warehouse_id)`.
- Cash and goods positions are tracked via the ledger under this custody's `account` (one
  `account` row of type `custody`, `owner_ref=custody.id`). Goods-as-value at foundation; physical
  stock detail deferred.

---

## 5. Customers & Receivables

### `customer`

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| code | VARCHAR(24) UNIQUE | system-generated stable identity (FR-018a) |
| name | VARCHAR(160) | |
| customer_type | ENUM('trader','plumber','other') | (FR-019) |
| phone | VARCHAR(32) NULL | captured, NOT unique; duplicates flagged not blocked (FR-018a) |
| rep_id | BIGINT FK→user.id | exactly one owner at a time (FR-020) |
| territory_id | BIGINT FK→territory.id | exactly one region at a time |
| active | BOOL default TRUE | no hard delete (FR-023) |
| created_at | DATETIME(6) | |

- **Reassignment** (FR-020a): updates `rep_id` + `territory_id` only; the `customer_account` and all
  prior ledger entries are unchanged (past entries keep their original `rep_id`). Permitted to System
  Admin and Branch/Purchasing Manager only. Audited.
- **No** loyalty column or table at Foundation. The loyalty-point balance and point-transfer
  mechanics are owned by and deferred to the After-Sales spec (constitution v1.1.2, Domain Scope
  items 1–2). Foundation guarantees only the stable `code` identity that loyalty later attaches to.

### `customer_account` (Receivables / ذمم)

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| customer_id | BIGINT FK→customer.id UNIQUE | one account per customer (FR-021) |
| created_at | DATETIME(6) | |

- Balance is **derived** from its `account` row (type `customer_receivable`, `owner_ref=this.id`) —
  no stored balance. Supports credit (آجل) and cash via ledger postings (mechanics of invoices/
  payments are later domains; foundation provides the account + posting capability).

---

## 6. Treasury

The single consolidated treasury is represented by exactly one `account` row of type `treasury`
(`owner_ref` NULL). No separate balance table; its balance is derived. Custodies reconcile to it via
ledger entries (a handover is one balanced entry: debit treasury / credit custody, or vice-versa).

---

## 7. Audit

### `audit_log_entry`

| Field | Type | Notes |
|-------|------|-------|
| id | BIGINT PK | |
| actor_user_id | BIGINT NULL FK→user.id | NULL allowed for failed login (unknown user) |
| action | VARCHAR(60) | e.g., `login.success`, `login.fail`, `role.change`, `customer.reassign`, `user.deactivate`, `ledger.post`, `ledger.reverse` |
| entity_type | VARCHAR(40) NULL | |
| entity_id | BIGINT NULL | |
| before_json | JSON NULL | |
| after_json | JSON NULL | |
| created_at | DATETIME(6) | |

- Append-only (FR-031). Reads are not logged.

---

## Relationship summary

```text
governorate 1───* branch 1───* territory 1───* user(rep)
                     │              │
                     │              └───* customer ──1 customer_account ──1 account(customer_receivable)
                     ├───* warehouse ──1 custody(warehouse) ──1 account(custody)
                     └───* user(branch-scoped)
user(rep) ──1 custody(rep) ──1 account(custody)
account(treasury) ─ singleton
ledger_entry 1───* ledger_line *───1 account
ledger_entry 0..1 reverses_entry_id ─ ledger_entry (mirror)
audit_log_entry *───1 user(actor)
```

## Validation rules (from requirements)

- Every `ledger_entry` balances: `Σ debit = Σ credit` (service-enforced before commit).
- `ledger_entry`/`ledger_line` rows are immutable; only reversal entries offset them (IV / FR-027/028).
- All balances derived from `ledger_line`; no standalone stored balance (VI / FR-026 / SC-004).
- One custody per holder; one customer_account per customer; one treasury account (FR-025/021/024).
- Branch-scoped users limited to their `branch_id`; reps to their own customers/custody; deny-by-default
  (VII / FR-006–011).
- Customer `code` unique & stable; `phone` non-unique with duplicate flag (FR-018a).
- Deactivate, never hard-delete, anything referenced by the ledger (FR-023, Edge Cases).
