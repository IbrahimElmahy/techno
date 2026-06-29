# Phase 1 Data Model: After-Sales Loyalty

Conventions: MySQL/MariaDB InnoDB, utf8mb4. PKs `BigIntPK`. Money `DECIMAL(18,2)` EGP; **points are
integers** (`BIGINT`, signed for deltas). Timestamps UTC. FKs `ON DELETE RESTRICT`. "Derived" values
computed on read — never stored.

**Extends 001/002, does not redefine them.** Reused as-is: `customer`, `customer_account`, `account`,
`ledger_entry`, `ledger_line`, `item` (products), `stock_movement` (via the 002 stock service),
`sales_invoice`, `sales_return`, `role`, `audit_log_entry`.

---

## 0. Ledger extension (in place)

`account.account_type` enum gains one value (additive migration):

| value | normal_side | owner_ref → |
|-------|-------------|-------------|
| `loyalty_expense` | debit | NULL (singleton P&L) |

All other values unchanged; balances stay `balance_of(account_id)` over `ledger_line`.

---

## 1. Per-product point value

### `product_point_value`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| item_id | BigInt FK→item.id UNIQUE | product only (kind=product) |
| point_value | BIGINT ≥ 0 | editable; earning snapshots this at invoice time |
| updated_by | BigInt FK→user.id NULL | |
| updated_at | DATETIME | |

Additive: the 002 `item` table is **not** modified.

---

## 2. Point ledger (append-only; balance derived)

### `point_record` (immutable)

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| customer_id | BigInt FK→customer.id | indexed |
| kind | ENUM('earn','reverse','converted','void_reclaim','adjustment') | |
| delta | BIGINT | signed: earn/void_reclaim > 0; reverse/converted/adjustment < 0 |
| sales_invoice_id | BigInt FK→sales_invoice.id NULL | for earn |
| sales_return_id | BigInt FK→sales_return.id NULL | for reverse / adjustment |
| origin_earn_id | BigInt FK→point_record.id NULL | reverse → its earn |
| conversion_id | BigInt FK→point_conversion.id NULL | for converted |
| coupon_id | BigInt FK→coupon.id NULL | for converted / void_reclaim |
| actor_user_id | BigInt FK→user.id NULL | NULL when system-driven by the sale hook |
| created_at | DATETIME | |

- **Immutable**: ORM guard + MySQL trigger reject UPDATE/DELETE.
- Index `(customer_id)` for balance derivation.
- **Balance(customer)** = `Σ delta` — **may be negative** (owed points). No stored balance.

---

## 3. Coupon-type catalog (settings)

### `coupon_type`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| name | VARCHAR(60) | |
| kind | ENUM('money','gift') | |
| point_cost | BIGINT > 0 | points consumed to issue one |
| value | DECIMAL(18,2) | monetary value/denomination |
| active | BOOL default TRUE | |

Runtime-managed by After-Sales Staff (FR-015). Editing never alters issued coupons (they snapshot).

---

## 4. Conversion & coupons

### `point_conversion` (header)

| id | customer_id FK | actor_user_id FK | created_at |

### `coupon`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| serial | VARCHAR(24) UNIQUE | server-generated, never reused (FR-009) |
| customer_id | BigInt FK→customer.id | |
| coupon_type_id | BigInt FK→coupon_type.id | provenance |
| kind | ENUM('money','gift') | snapshot of type |
| value | DECIMAL(18,2) | snapshot of type |
| points_consumed | BIGINT | snapshot of type.point_cost |
| status | ENUM('issued','redeemed','voided') | FR-010 |
| conversion_id | BigInt FK→point_conversion.id | issuance event |
| created_at | DATETIME | |

- A coupon redeems **at most once**; reversal of a redemption returns it to `issued`.
- For a **gift** coupon, the redemption mode/target is decided at redemption (not stored at issuance).

---

## 5. Redemption

### `coupon_redemption`

| Field | Type | Notes |
|-------|------|-------|
| id | BigIntPK | |
| coupon_id | BigInt FK→coupon.id | |
| mode | ENUM('money','gift_product','gift_money_off') | chosen at redemption |
| value | DECIMAL(18,2) | applied value (≤ coupon value) |
| customer_id | BigInt FK→customer.id | |
| sales_invoice_id | BigInt FK→sales_invoice.id NULL | NULL for standalone (FR-013) |
| ledger_entry_id | BigInt FK→ledger_entry.id NULL | money / gift_money_off only |
| item_id | BigInt FK→item.id NULL | gift_product only |
| location_kind / location_id | ENUM / BigInt NULL | gift_product only |
| quantity | DECIMAL(18,3) NULL | gift_product only |
| stock_movement_id | BigInt FK→stock_movement.id NULL | gift_product only |
| reverses_redemption_id | BigInt FK→coupon_redemption.id UNIQUE NULL | reverse-once |
| actor_user_id | BigInt FK→user.id | |
| created_at | DATETIME | |

Money / gift_money_off post one balanced ledger entry (debit `loyalty_expense`, credit
`customer_receivable`). gift_product posts a stock movement only (no ledger). Reversal posts the mirror
ledger entry and/or a stock reversal via the 002 stock service, and returns the coupon to `issued`.

---

## Money / points posting summary

| Operation | Money (ledger) | Points (point_record) | Stock |
|-----------|----------------|------------------------|-------|
| Sale created (002 hook) | — | earn +Σ(point_value×qty) | — |
| Sale return (002 hook) | — | reverse −(returned); + void_reclaim / − adjustment (Q3) | — |
| Convert points→coupons | — | converted −(Σ point_cost) | — |
| Redeem money / gift money-off (V) | debit loyalty_expense V / credit receivable V | — | — |
| Redeem gift product | — | — | stock_out at location (no-negative) |
| Reverse any redemption | mirror entry (if money) | — | stock reversal (if product) |

## Validation rules (from requirements)

- Point balance = Σ `point_record.delta`; never stored; may be negative (FR-005; SC-002).
- `point_record` immutable; corrections are new linked records (IV).
- Coupon `serial` UNIQUE; coupon redeems at most once; status ∈ {issued, redeemed, voided} (FR-009/010).
- Conversion in whole coupons; reject if a type's `point_cost` > available balance (FR-007/008).
- Money / gift-money-off post one balanced entry to `loyalty_expense` / `customer_receivable` (FR-011/012).
- Gift-product redemption decrements stock via the 002 service, rejected if it would go negative
  (FR-012; Principle XI) — **no ledger entry**.
- Every redemption reversible, reverse-once; reversing returns the coupon to `issued` (FR-014).
- Editing a product point value or coupon type never alters posted earnings or issued coupons (FR-002/015).
