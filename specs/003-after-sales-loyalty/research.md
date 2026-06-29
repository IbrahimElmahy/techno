# Phase 0 Research: After-Sales Loyalty

Stack and most behavior are fixed by the spec, the clarifications, and constitution v1.3.0. This
records the design decisions shaping Phase 1, with rationale and rejected alternatives. It assumes the
implemented 001 (ledger, RBAC, customers) and 002 (catalog/products, stock service, sales invoices).

## R1. Ledger extension — `loyalty_expense`

- **Decision**: Add one `account_type` value, `loyalty_expense` (normal **debit**, singleton P&L),
  additive to the existing `account` enum (same pattern as 002's `supplier_payable`/`sales_revenue`/
  `purchases_expense`). No new ledger, no balance store.
- **Money postings** (one balanced entry each, via Foundation `post_entry`):
  - **Money coupon** redeem (value V): debit `loyalty_expense` V, credit `customer_receivable` V.
  - **Gift money-off** redeem (value V): identical to money coupon (clarify Q4).
  - **Gift-product** redeem: **no ledger entry** — stock-only (clarify Q3), consistent with 002's
    quantity-only inventory (deferred COGS).
- **Rationale**: VI (one ledger, derived balances). A money coupon reduces what the customer owes and
  recognizes the give-back as a marketing expense.

## R2. Per-product point value — additive, no 002 schema change

- **Decision**: A separate `product_point_value(item_id UNIQUE, point_value BIGINT, updated_by)` table
  keyed to the 002 `item` (products only). It is **not** a column on `item`, so 002's catalog model is
  untouched (truly additive). Earning **snapshots** the value at invoice time onto the earn record.
- **Rationale**: FR-001/002; "extends the product concept without breaking 002's catalog." Snapshotting
  satisfies FR-002 (edits never alter past earnings).
- **Alternatives considered**: a `point_value` column on `item` (modifies a 002 model file — avoided).

## R3. Point ledger — append-only records; balance derived (may go negative)

- **Decision**: `point_record` is immutable/append-only with a signed `delta BIGINT` and a `kind`:
  - `earn` (+, linked to sales_invoice) — `delta = Σ(point_value × qty)` snapshotted.
  - `reverse` (−, linked to sales_return + original earn) — points for the returned quantity.
  - `converted` (−, linked to a point_conversion) — the coupon's point cost.
  - `void_reclaim` (+, linked to the voided coupon) — reclaim points when an unredeemed coupon is voided.
  - `adjustment` (−, linked to a sales_return) — owed-points settlement when reclaim is impossible.
  Balance = `Σ delta`, **may be negative**. Immutability via ORM event guard + MySQL trigger (mirrors
  ledger/stock_movement).
- **Rationale**: IV + SC-002; the Q3 hybrid needs immutable, linked history and a balance that can go
  negative. No stored balance (derive-not-store).

## R4. Earning integration — hook registry (002 → 003, no reverse import)

- **Decision**: Add a tiny `core/hooks.py` registry with named hooks `sale_created(db, invoice)` and
  `sale_returned(db, sales_return, invoice)`. 002's `sales_service.create_sale` / `return_sale` call the
  registry (no-op if unsubscribed) **within the same transaction**, before commit. 003's
  `loyalty_hooks` subscribes at import/app-startup to post the earn / reverse records.
- **Rationale**: earning must be transactional + immutable at invoice time (FR-003) while 002 stays
  independent of 003. The 002 touch is one additive call per path (emit event), not a behavior change.
- **Alternatives considered**: 002 importing 003 (bad dependency direction); a post-sale 003 endpoint
  (not transactional, can drift); derived earning (no immutable earn record; breaks void/adjustment).

## R5. Return-after-consumption hybrid (Q3)

- **Decision**: On `sale_returned`, the loyalty hook posts a `reverse` for the returned quantity's
  points. The point_service then reconciles the resulting shortfall against coupons funded by the
  returned earn:
  - For each **unredeemed** coupon linked (transitively) to the returned earn, **void** it (status
    `voided`) and post `void_reclaim` (+cost) — points are reclaimed, not double-counted.
  - If a shortfall remains because a funded coupon is **already redeemed**, post a single negative
    `adjustment` for the residual (balance may go negative, settled against future earnings).
  - The **return is never blocked.**
- **Rationale**: FR-004 (a/b); IV. All effects are new linked records; nothing is mutated.
- **Note**: the earn→conversion→coupon linkage is tracked so reconciliation can find funded coupons;
  exact FIFO/most-recent selection is an implementation detail covered test-first.

## R6. Coupon-type catalog, conversion, coupon snapshot

- **Decision**: `coupon_type(name, kind money|gift, point_cost BIGINT, value DECIMAL, active)` is the
  runtime settings catalog (Q1). `point_conversion` is a header; converting issues N `coupon` rows,
  each snapshotting `kind/value/point_cost` from its type and consuming `point_cost` via a `converted`
  point_record. Whole coupons only (Q2): reject if the type's cost exceeds the available balance.
- **Coupon**: unique `serial` (e.g., `CPN-XXXXXXXX`), customer, snapshot fields, `points_consumed`,
  `status` ∈ {issued, redeemed, voided}.
- **Rationale**: FR-007/009/015; snapshot satisfies "settings changes don't alter issued coupons".

## R7. Redemption & reversal

- **Decision**: `coupon_redemption(coupon_id, mode money|gift_product|gift_money_off, ...)`:
  - `money` / `gift_money_off`: `ledger_entry_id` (debit loyalty_expense / credit receivable), value =
    coupon value (gift-product value must be ≤ coupon value when product mode).
  - `gift_product`: `item_id`, location, quantity, `stock_movement_id` (002 stock service, no-negative);
    no ledger entry.
  - `reverses_redemption_id` (UNIQUE) for reverse-once; reversing returns the coupon to `issued`. A
    coupon redeems at most once (status guard).
  - **Redemption mode/target chosen at redemption** (Q2), not at issuance.
- **Rationale**: FR-011–014; V/XI for the stock path; IV for reversal.

## R8. Coupon serial uniqueness

- **Decision**: `coupon.serial` is a UNIQUE column; serials are server-generated and never reused.
  Tested first (Principle X) for collisions and concurrent issuance.
- **Rationale**: FR-009; SC-003.

## R9. RBAC additions

- **Decision**: Extend the Foundation capability map (no new mechanism): `loyalty.read`,
  `product_points.write`, `loyalty_settings.write`, `points.convert`, `coupon.redeem`,
  `coupon.reverse`. Granted to **After-Sales Staff** and System Admin. Point **earning/reversal** is
  driven by the sale hook and needs no extra capability.
- **Rationale**: FR-016; reuse deny-by-default + scope predicates.

## R10. Migration (additive)

- **Decision**: One Alembic revision `0003_after_sales_loyalty`, `down_revision = 0002_sales_inventory`.
  (a) extend the `account` enum (+`loyalty_expense`), (b) create new tables, (c) install the
  `point_record` immutability triggers (UPDATE/DELETE) like the ledger/stock_movement. No 001/002 table
  dropped or redefined; no data backfill.
- **Rationale**: I + additive-only integration. SQLite test path uses `create_all` + the ORM guard.
