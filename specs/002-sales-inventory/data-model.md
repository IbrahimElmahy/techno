# Phase 1 Data Model: Sales & Inventory

Conventions: MySQL/MariaDB InnoDB, utf8mb4. PKs `BigIntPK` (BIGINT prod / INTEGER sqlite). Money
`DECIMAL(18,2)` EGP; quantity `DECIMAL(18,3)`. Timestamps UTC. FKs `ON DELETE RESTRICT` (deactivate,
never destructively delete). "Derived" values are computed on read — never stored.

**Extends Foundation, does not redefine it.** Referenced as-is: `user`, `role`, `branch`, `territory`,
`warehouse`, `custody`, `customer`, `customer_account`, `account`, `ledger_entry`, `ledger_line`,
`audit_log_entry`.

---

## 0. Ledger extension (in place)

`account.account_type` enum gains three values (additive migration):

| value | normal_side | owner_ref → |
|-------|-------------|-------------|
| `supplier_payable` | credit | supplier_account.id |
| `sales_revenue` | credit | NULL (singleton) |
| `purchases_expense` | debit | NULL (singleton) |

Existing values (`treasury`, `custody`, `customer_receivable`) unchanged. All balances remain
`balance_of(account_id)` over `ledger_line` — no new balance store.

---

## 1. Catalog

### `item`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| code | VARCHAR(32) UNIQUE | system-generated, **editable** (FR-002) |
| name | VARCHAR(160) | |
| kind | ENUM('raw_material','product') | FR-001 |
| unit_of_measure | VARCHAR(16) | kg, L, piece … (FR-002, Q5) |
| purchase_price | DECIMAL(18,2) NULL | raw materials only (reference) |
| sale_price | DECIMAL(18,2) NULL | products only (one fixed price) |
| active | BOOL default TRUE | |
| created_at | DATETIME | |

- Constraint: `kind='raw_material'` ⇒ sale_price NULL; `kind='product'` ⇒ purchase_price NULL
  (service-enforced; check constraint where feasible).

---

## 2. Suppliers

### `supplier`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| code | VARCHAR(24) UNIQUE | system-generated |
| name | VARCHAR(160) | |
| phone | VARCHAR(32) NULL | |
| active | BOOL default TRUE | |

### `supplier_account` (Payables / ذمم موردين)

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| supplier_id | BigInt FK→supplier.id UNIQUE | one account per supplier |
| account_id | BigInt FK→account.id | a `supplier_payable` account; balance derived |

Mirrors Foundation `customer_account`.

---

## 3. Stock (append-only; on-hand derived)

### `stock_movement` (immutable)

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| item_id | BigInt FK→item.id | |
| location_kind | ENUM('warehouse','custody') | |
| location_id | BigInt | warehouse.id or custody.id (by kind) |
| movement_type | VARCHAR(32) | purchase_in, consumption_out, production_in, sale_out, transfer_out, transfer_in, purchase_return_out, sale_return_in, + reversals |
| direction | ENUM('in','out') | |
| quantity | DECIMAL(18,3) | > 0 |
| source_doc_type | VARCHAR(24) | purchase, sale, transfer, manufacturing, return |
| source_doc_id | BigInt | the owning document |
| reverses_movement_id | BigInt NULL FK→stock_movement.id UNIQUE | reverse-once |
| actor_user_id | BigInt FK→user.id | |
| created_at | DATETIME | |

- **Immutable**: ORM guard + MySQL trigger reject UPDATE/DELETE.
- Index `(item_id, location_kind, location_id)` for on-hand derivation.
- on-hand = `Σ(quantity where direction='in') − Σ(quantity where direction='out')` for the triple.

### `stock_locator` (lock anchor — not a balance)

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| item_id | BigInt FK→item.id | |
| location_kind | ENUM('warehouse','custody') | |
| location_id | BigInt | |
| UNIQUE(item_id, location_kind, location_id) | | one anchor per (item × location) |

Locked `FOR UPDATE` during writes to serialize No-Negative-Stock checks (research R3). Stores no
quantity.

---

## 4. Purchases

### `purchase_invoice`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| document_number | VARCHAR(24) UNIQUE | PINV-###### |
| supplier_id | BigInt FK→supplier.id | |
| location_kind / location_id | ENUM / BigInt | destination location |
| total | DECIMAL(18,2) | Σ line_total |
| cash_amount | DECIMAL(18,2) | cash + credit = total |
| credit_amount | DECIMAL(18,2) | posts to supplier_payable |
| ledger_entry_id | BigInt FK→ledger_entry.id | the balanced money entry |
| actor_user_id | BigInt FK→user.id | |
| created_at | DATETIME | |

### `purchase_invoice_line`

| id | invoice_id FK | item_id FK (raw only) | quantity DECIMAL(18,3) | unit_price DECIMAL(18,2) snapshot | line_total |

### `purchase_return` / `purchase_return_line`
Linked to a `purchase_invoice`; caller supplies per-line `quantity` only; cumulative ≤ purchased. The
money reversal is **computed proportionally** from the original purchase's cash/credit composition
(reduce supplier_payable by `credit%`, treasury/custody by `cash%`, of the returned value) — not
caller-provided. Own `ledger_entry_id` + `purchase_return_out` movements. Reversible.

---

## 5. Sales

### `sales_invoice`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| document_number | VARCHAR(24) UNIQUE | SINV-###### |
| customer_id | BigInt FK→customer.id | |
| origin_location_kind / origin_location_id | ENUM / BigInt | rep custody or branch warehouse |
| gross | DECIMAL(18,2) | Σ line_total |
| fixed_discount_pct | DECIMAL(5,2) | snapshot from settings |
| variable_discount_pct | DECIMAL(5,2) | entered at invoice time |
| combined_pct | DECIMAL(5,2) | fixed + variable |
| net | DECIMAL(18,2) | gross × (1 − combined_pct/100), 2dp |
| cash_amount | DECIMAL(18,2) | to actor cash location |
| credit_amount | DECIMAL(18,2) | to customer_receivable; cash+credit = net |
| cash_account_id | BigInt FK→account.id | resolved actor cash location (rep custody / branch) |
| ledger_entry_id | BigInt FK→ledger_entry.id | balanced entry |
| actor_user_id | BigInt FK→user.id | |
| created_at | DATETIME | |

### `sales_invoice_line`

| id | invoice_id FK | item_id FK (product only) | quantity DECIMAL(18,3) | unit_price DECIMAL(18,2) snapshot (product fixed price) | line_total |

### `sales_return` / `sales_return_line`
Linked to a `sales_invoice`; caller supplies per-line `quantity` only; cumulative ≤ sold. The money
reversal is **computed proportionally** from the original invoice's cash/credit composition (refund
`cash%` of the returned value to the cash location, reduce customer_receivable by `credit%`) and stored
as derived `cash_refund` / `credit_reduction` on the return record — **not** caller-provided. Posts
`sale_return_in` movements + one balanced reversing ledger entry. Reversible.

### `sales_setting` (singleton)

| id | fixed_discount_pct DECIMAL(5,2) | updated_by FK→user.id | updated_at |

Runtime fixed discount %; changes never alter posted invoices (snapshotted on each invoice).

---

## 6. Manufacturing

### `manufacturing_op`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| document_number | VARCHAR(24) UNIQUE | MFG-###### |
| op_type | ENUM('consume','produce') | |
| item_id | BigInt FK→item.id | consume⇒raw, produce⇒product |
| location_kind / location_id | ENUM / BigInt | |
| quantity | DECIMAL(18,3) | |
| stock_movement_id | BigInt FK→stock_movement.id | the single movement it created |
| actor_user_id | BigInt FK→user.id | |
| created_at | DATETIME | |

Two independent ops; no linkage, no money effect. Each op is **reversible** via an explicit reverse
operation (`POST /manufacturing/{id}/reverse`) that creates a linked mirror stock movement
(reverse-once); no money effect; a reversed produce is subject to No-Negative-Stock.

---

## 7. Transfers

### `stock_transfer`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| document_number | VARCHAR(24) UNIQUE | TRF-###### |
| item_id | BigInt FK→item.id | |
| quantity | DECIMAL(18,3) | |
| route | ENUM('central_to_branch','central_to_rep','rep_to_rep') | FR-022 |
| source_location_kind / source_location_id | ENUM / BigInt | |
| dest_location_kind / dest_location_id | ENUM / BigInt | |
| status | ENUM('pending','approved','rejected','reversed') | |
| initiated_by | BigInt FK→user.id | |
| approved_by | BigInt NULL FK→user.id | Branch Manager (FR-027) |
| approved_at | DATETIME NULL | |
| out_movement_id / in_movement_id | BigInt NULL FK→stock_movement.id | created on approval |
| created_at | DATETIME | |

No stock moves while `pending`. Approval is by the Branch Manager managing the **source location's
branch** (central source ⇒ head-office/central authority); a non-source-branch manager is denied
(FR-023). Approval creates the out+in movement pair atomically (both under locator locks; source
checked for no-negative). Reverse-transfer creates the mirror pair.

---

## Money-posting summary (all via Foundation `post_entry`, one balanced entry each)

| Operation | Debit | Credit |
|-----------|-------|--------|
| Sale (net N = cash C + credit R) | cash-location C, customer_receivable R | sales_revenue N |
| Sales return (value V; original split cash%/credit%) | sales_revenue V | cash-location V·cash%, customer_receivable V·credit% |
| Purchase (total T = cash C + credit P) | purchases_expense T | cash-location C, supplier_payable P |
| Purchase return (value V; original split cash%/credit%) | cash-location V·cash%, supplier_payable V·credit% | purchases_expense V |
| Custody→treasury handover | treasury | custody |

Manufacturing (consume/produce) and transfers post **no** ledger entry — stock movements only.

## Validation rules (from requirements)

- on-hand per (item × location) = Σ movements; never stored (SC-002).
- No movement may drive on-hand < 0 (Principle XI / FR-008), checked under the locator lock.
- `stock_movement` immutable; corrections are linked reversals; reverse-once via UNIQUE
  `reverses_movement_id` (FR-007/025).
- Returns partial: cumulative returned per line ≤ original (FR-012/021); the money reversal is computed
  **proportionally** from the original document's cash/credit split (caller supplies quantities only).
- Manufacturing consume/produce are reversible via an explicit reverse op (linked mirror movement,
  reverse-once, no money) — FR-016.
- Raw materials not sellable; products not purchasable (FR-003/004).
- Every money event posts one balanced entry to the Foundation ledger; balances derived (Principle VI).
- combined_pct = fixed + variable, applied once to gross; cash + credit = net (FR-019/020).
- Deactivate, never hard-delete, anything referenced by movements/ledger (FR-023 pattern).
