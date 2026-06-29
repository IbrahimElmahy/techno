---
description: "Task list for After-Sales Loyalty implementation (additive to 001 + 002)"
---

# Tasks: After-Sales Loyalty (Points & Coupons)

**Input**: Design documents from `/specs/003-after-sales-loyalty/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml
**Builds on**: Foundation (`001`) + Sales & Inventory (`002`) — reuse ledger, RBAC, customers, products,
the 002 stock service, sales invoices/returns, audit. **002 never imports 003** (hook registry).

**Tests**: REQUIRED. Principle X mandates test-first for the five critical paths: **point-balance
derivation (negative-capable)**, **coupon-serial uniqueness**, **money-coupon ledger balancing**,
**redemption reversal symmetry**, and the **return-after-consumption hybrid**. Each gets a failing
[test] before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` red-green · `[US#]` user story · each task cites
its FR(s)/scenario(s). **Path base**: `backend/` (additive — do not modify 001/002 behavior beyond the
ledger enum and the single sales-hook emit).

---

## Phase 1: Setup & Ledger / Hooks Extension

- [X] T001 [impl] Extend `src/models/ledger.py` `AccountType` enum with `loyalty_expense` (normal debit, singleton) — research R1; Principle VI
- [X] T002 [impl] `src/core/hooks.py`: a tiny named-event registry (`subscribe(name, fn)` / `emit(name, **kw)`) — research R4
- [X] T003 [impl] Add **emit calls** to `src/services/sales_service.py`: `emit("sale_created", db, invoice)` in `create_sale` and `emit("sale_returned", db, sales_return, invoice)` in `return_sale` (no-op if unsubscribed; same transaction, before commit) — research R4 (single additive 002 touch; 002 does not import 003)
- [X] T004 [P] [impl] Extend `src/auth/rbac.py` capability map: `loyalty.read`, `product_points.write`, `loyalty_settings.write`, `points.convert`, `coupon.redeem`, `coupon.reverse` → After-Sales Staff + System Admin — FR-016; research R9
- [X] T005 [P] [impl] `src/services/account_resolver.py`: add `loyalty_expense_account()` (get-or-create singleton) — research R1
- [X] T006 [impl] Extend `tests/conftest.py` fixtures: a customer with receivable account, a product + point-value factory, and a coupon-type factory — reused by all phases

**Checkpoint**: ledger extended; hook registry live; 002 emits sale events; capabilities ready.

---

## Phase 2: Point Ledger Core (append-only; derived, negative-capable) 🎯 the heart

**Goal**: Immutable `point_record`; balance = Σ delta (may go negative); reversible by new records.
**Independent Test**: Post earn/reverse/converted/void_reclaim/adjustment records; balance equals the
signed sum (incl. negative); records cannot be mutated.

### Tests first (Principle X)

- [X] T007 [P] [test] `tests/unit/test_point_balance.py`: balance == Σ delta after a mixed sequence incl. a negative adjustment → **balance may be negative**; no stored balance column — FR-005; SC-002
- [X] T008 [P] [test] `tests/unit/test_point_record_immutable.py`: UPDATE/DELETE on a posted `point_record` rejected (ORM guard) — FR-005; Principle IV

### Implementation (make T007–T008 green)

- [X] T009 [impl] `src/models/loyalty.py`: `PointRecord` (immutable; customer, kind earn|reverse|converted|void_reclaim|adjustment, signed `delta` BIGINT, links: sales_invoice/return, origin_earn, conversion, coupon, actor) + ORM immutability guard — data-model §2
- [X] T010 [impl] `src/services/point_service.py`: `balance(customer_id)` = Σ delta; `_post_record(...)` helper — FR-005

**Checkpoint**: T007–T008 green. Point balance is a verified, derived, negative-capable source of truth.

---

## Phase 3: Per-Product Point Value (settings) — [US1]

**Goal**: Editable per-product point value; edits never alter past earnings.
**Independent Test**: Set value 5→8; current is 8 and prior earnings unchanged.

- [X] T011 [impl] [US1] `src/models/loyalty.py`: `ProductPointValue` (item_id UNIQUE, point_value ≥ 0, updated_by) — FR-001; data-model §1
- [X] T012 [impl] [US1] `src/api/product_points.py`: `PUT /products/{item_id}/point-value` (product-only; capability `product_points.write`) — FR-001/002
- [X] T013 [P] [test] [US1] `tests/integration/test_product_points.py`: set/edit value; non-product rejected; editing does not change points already earned (snapshot) — US1 scenarios 1–2

**Checkpoint**: products carry editable point values.

---

## Phase 4: Earning on Sale + Reversal on Return (via hook) — [US2]

**Goal**: A 002 sale earns `Σ(point value × qty)` (cash or credit); a return reverses the returned
quantity's points — all driven by the hook, in the sale's transaction.
**Independent Test**: Sale of 3 × 5pts → +15; partial return of 1 → −5 (linked to the earn).

- [X] T014 [impl] [US2] `src/services/point_service.py` `earn_for_invoice(db, invoice)`: snapshot each line's product point value × qty → one `earn` record — FR-003
- [X] T015 [impl] [US2] `src/services/point_service.py` `reverse_for_return(db, sales_return, invoice)`: post `reverse` for the returned quantity, linked to the original earn — FR-004 (base path; hybrid reconciliation in Phase 9)
- [X] T016 [impl] [US2] `src/services/loyalty_hooks.py`: subscribe `sale_created`→`earn_for_invoice`, `sale_returned`→`reverse_for_return`; register on app startup (`main.py`) — research R4
- [X] T017 [P] [test] [US2] `tests/integration/test_earn_on_sale.py`: sale earns 15; cash == credit earning; partial return reverses proportionally — US2 scenarios 1–3; SC-001

**Checkpoint**: points earn/reverse automatically with sales.

---

## Phase 5: Coupon-Type Catalog (settings) — [US6]

**Goal**: Runtime catalog of coupon types (kind, point cost, value); edits never alter issued coupons.
**Independent Test**: Create/edit a type; non-After-Sales role denied.

- [X] T018 [impl] [US6] `src/models/loyalty.py`: `CouponType` (name, kind money|gift, point_cost > 0, value, active) — FR-015; data-model §3
- [X] T019 [impl] [US6] `src/api/loyalty_settings.py`: list/create/patch coupon-types (capability `loyalty_settings.write`) — FR-015
- [X] T020 [P] [test] [US6] `tests/integration/test_loyalty_settings.py`: create/edit a type; non-After-Sales role denied; editing does not alter already-issued coupons — US6 scenarios 1–2

**Checkpoint**: coupon types configurable at runtime.

---

## Phase 6: Points → Coupons (conversion, whole-coupon-only) — [US3]

**Goal**: Convert points into coupons by selecting types; unique serials; whole coupons only.
**Independent Test**: 120 pts, a 50-pt type → 2 coupons (100 consumed), 20 remain; below-cost rejected.

### Tests first (Principle X — serial uniqueness)

- [X] T021 [P] [test] [US3] `tests/unit/test_coupon_serial_unique.py`: issued coupon serials are unique; a duplicate/concurrent serial is never issued — FR-009; SC-003

### Implementation

- [X] T022 [impl] [US3] `src/models/loyalty.py`: `PointConversion` (header) + `Coupon` (serial UNIQUE, customer, coupon_type_id, snapshot kind/value/points_consumed, status issued|redeemed|voided) — data-model §4
- [X] T023 [impl] [US3] `src/services/point_service.py` `convert(db, customer, coupon_type_ids, actor)`: whole-coupon-only; each coupon consumes its type's point_cost via a `converted` record; reject if a type's cost > available balance — FR-007/008
- [X] T024 [impl] [US3] `src/api/points.py`: `GET /customers/{id}/points` (derived balance), `POST /customers/{id}/points/convert` (capability `points.convert`) — FR-007
- [X] T025 [P] [test] [US3] `tests/integration/test_convert.py`: whole coupons issued; remainder stays as balance; insufficient/partial rejected; serials present — US3 scenarios 1–4

**Checkpoint**: points become unique coupons; balance stays derived.

---

## Phase 7: Coupon Redemption (money / gift) — [US4][US5]

**Goal**: Money & gift-money-off post one balanced ledger entry (loyalty_expense/receivable);
gift-product decrements stock via the 002 service (no-negative, no ledger). Redeem at most once.
**Independent Test**: Redeem money 50 → receivable −50, loyalty_expense +50 (balanced); redeem
gift-product → stock −1 (no ledger); redeem again → 409.

### Tests first (Principle X — money-coupon ledger balancing)

- [X] T026 [P] [test] [US4] `tests/unit/test_money_coupon_ledger.py`: money & gift-money-off post ONE balanced entry (debit loyalty_expense, credit customer_receivable; Σdebit=Σcredit); gift-product posts **no** ledger entry — FR-011/012; SC-004

### Implementation

- [X] T027 [impl] `src/models/loyalty.py`: `CouponRedemption` (mode money|gift_product|gift_money_off, value, links: ledger_entry/item/location/quantity/stock_movement, `reverses_redemption_id` UNIQUE) — data-model §5
- [X] T028 [impl] [US4] `src/services/coupon_service.py` `redeem_money()` / `redeem_gift_money_off()`: balanced entry via `post_entry` (debit loyalty_expense, credit receivable), coupon→redeemed, at-most-once — FR-011/012
- [X] T029 [impl] [US5] `src/services/coupon_service.py` `redeem_gift_product()`: `stock_out` via the 002 stock service (no-negative, Principle XI), value ≤ coupon value, no ledger — FR-012
- [X] T030 [impl] `src/api/coupons.py`: `GET /coupons`, `POST /coupons/{id}/redeem` (mode dispatch; standalone or on-invoice) (capability `coupon.redeem`) — FR-011–013
- [X] T031 [P] [test] [US5] `tests/integration/test_redeem_gift.py`: gift-product decrements stock (rejected if negative, no ledger entry); gift-money-off posts the loyalty_expense/receivable entry — US5 scenarios 1–2; Principle XI

**Checkpoint**: coupons redeem with correct money/stock effects.

---

## Phase 8: Redemption Reversal — [US4][US5]

**Goal**: Every redemption reversible, reverse-once; reversal returns the coupon to `issued`.
**Independent Test**: Reverse a money redemption → ledger mirrored, coupon issued; second reverse → 409.

### Tests first (Principle X — reversal symmetry)

- [X] T032 [P] [test] `tests/unit/test_redemption_reversal.py`: reverse-once; money reverses the ledger entry, gift-product reverses the stock movement; coupon returns to `issued`; a coupon redeems at most once — FR-014; SC-006

### Implementation

- [X] T033 [impl] `src/services/coupon_service.py` `reverse_redemption()`: mirror ledger entry (money) and/or stock reversal (product) via 002 service; coupon→issued; reverse-once — FR-014
- [X] T034 [impl] `src/api/coupons.py`: `POST /coupons/{id}/redemption/reverse` (capability `coupon.reverse`) — FR-014

**Checkpoint**: redemptions are fully reversible.

---

## Phase 9: Return-After-Consumption Hybrid (Q3) — [US2]

**Goal**: A return never blocks; if reversed points were already consumed, **void** unredeemed funded
coupons (reclaim) else record a **negative adjustment** — all new linked records.
**Independent Test**: (a) unredeemed funded coupon → voided + reclaim; (b) already-redeemed → negative
adjustment (balance goes negative); the return always succeeds.

### Tests first (Principle X — the hybrid)

- [X] T035 [P] [test] [US2] `tests/integration/test_return_after_consumption.py`: (a) unredeemed funded coupon is voided and points reclaimed; (b) already-redeemed coupon yields a negative point adjustment (balance < 0); the return is never blocked — FR-004; US2 scenarios 4–5

### Implementation

- [X] T036 [impl] [US2] `src/services/point_service.py` `reconcile_return()`: after the base reverse, void unredeemed coupons funded by the returned earn (`void_reclaim`); for residual funded-but-redeemed points, post one negative `adjustment`; never block — FR-004; research R5
- [X] T037 [impl] [US2] Wire `reconcile_return` into the `sale_returned` hook (after `reverse_for_return`) — research R4/R5

**Checkpoint**: returns are safe regardless of conversion/redemption state.

---

## Phase 10: Migration, Contract & Polish

- [X] T038 [impl] Register loyalty models in `src/models/__init__.py`; verify `Base.metadata` create_all (SQLite) + migration (MySQL) agree
- [X] T039 [impl] Alembic `0003_after_sales_loyalty` (down_revision `0002_sales_inventory`): MySQL `MODIFY` account enum (+`loyalty_expense`), create all new tables, install `point_record` immutability triggers — research R10; additive only
- [X] T040 [P] [test] `tests/integration/test_migration_additive_003.py`: down_revision is `0002_sales_inventory`; new tables in metadata; `AccountType` includes `loyalty_expense`
- [X] T041 [impl] Extend `scripts/check_contract_drift.py` to include the 003 contract; the 001+002 gate stays green — Principle II
- [X] T042 [P] [test] `tests/contract/test_loyalty_contract.py`: new endpoints present in `/openapi.json`; error envelopes (403 scope, 409 insufficient-points/no-negative-stock/already-redeemed)
- [X] T043 [P] [impl] Index review (`point_record(customer_id)`, `coupon.serial` UNIQUE) + run quickstart smoke end-to-end

---

## Dependencies & Execution Order

### Phase order (hard sequence)
Setup & Ledger/Hooks (P1) → **Point Ledger Core (P2)** → Product Point Value (P3) → Earning/Return
(P4) → Coupon-Type Catalog (P5) → Conversion (P6) → Redemption (P7) → Reversal (P8) → Return-After-
Consumption Hybrid (P9) → Migration/Contract/Polish (P10).

Rationale: every point operation depends on the point ledger (P2 first); earning depends on the hook
registry + 002 emit (P1); conversion depends on the catalog (P5) and the point ledger; redemption money
effects depend on `loyalty_expense` (P1); the hybrid depends on conversion + redemption existing.

### Test-before-impl pairings (Principle X)
- T007–T008 (balance / immutability) **before** T009–T010.
- T021 (serial uniqueness) **before** T022–T024.
- T026 (money ledger balancing) **before** T027–T030.
- T032 (reversal symmetry) **before** T033–T034.
- T035 (return-after-consumption hybrid) **before** T036–T037.

### Key blocking edges
- T001 → T005 → T028 (money redemption); T002 → T003, T016.
- T009 → T010 → {T014, T015, T023, T036}; T011 → T014 (point value snapshot).
- T018 → T022/T023 (conversion needs types); T022 → T027 (redemption needs coupons).
- T004 (capabilities) → all routers (T012, T019, T024, T030, T034).

### Parallel opportunities
- Setup: T004, T005 parallel; T006 after models exist.
- Point-ledger tests T007, T008 parallel; critical-path tests T021/T026/T032/T035 are each before their phase impl but mutually parallel across phases.
- Integration tests (T013, T017, T020, T025, T031, T040, T042) mutually parallel.

---

## Implementation Strategy

### MVP backbone first
1. Phases 1–2: ledger + hooks + the verified point ledger (derived, negative-capable, immutable).
2. Phases 3–4: product point values + earning/reversal on sales — the core value loop.
3. **STOP and VALIDATE**: point-balance + earn-on-sale green before coupons.

### Incremental delivery
- +Catalog (P5) + Conversion (P6) → points become coupons → demo. +Redemption (P7) → money/gift value
  out → demo. +Reversal (P8) → safe corrections. +Hybrid (P9) → safe returns. +Migration/Polish (P10) → ship.

### Notes
- All money via Foundation `ledger_service.post_entry` as ONE balanced entry; balances derived.
- Points are integers; balance derived from `point_record` and **may go negative** (owed points).
- Gift-product redemption is **stock-only** (no ledger) via the 002 stock service (no-negative).
- Additive only: one migration chained on `0002_sales_inventory`; the only 002 touch is the sales-hook
  emit (T003); **002 never imports 003**.
