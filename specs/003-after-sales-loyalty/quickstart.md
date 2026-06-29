# Quickstart: After-Sales Loyalty (extends 001 + 002)

## Prerequisites

- 001 + 002 implemented; `backend/` venv and DB set up.
- Apply the additive migration: `cd backend && alembic upgrade head` (→ `0003_after_sales_loyalty`:
  `account` enum +`loyalty_expense`, new tables, `point_record` immutability triggers).
- Same `.env` / `DATABASE_URL`. Tests run on SQLite in-memory; migration check on MySQL/MariaDB.

## Smoke flow (maps to acceptance scenarios)

1. **Point values (US1)**: set a product's point value to 5.
2. **Earn (US2)**: create a 002 sale of 3 units → customer earns 15 points (immutable earn record).
3. **Convert (US3)**: define a coupon type (kind=money, point_cost=50, value=50) and a gift type;
   with ≥100 points, convert 2 money coupons → 100 points consumed, 2 unique serials.
4. **Redeem money (US4)**: redeem a money coupon (50) → receivable −50, loyalty_expense +50 in one
   balanced entry; coupon=redeemed; redeeming again → 409.
5. **Redeem gift (US5)**: redeem a gift coupon as a product → stock decremented (no-negative, no
   ledger); or as money-off → posts like a money coupon.
6. **Return reversal (US2/Q3)**: return the earning invoice → points reversed; an unredeemed funded
   coupon is voided (reclaim); an already-redeemed one yields a negative adjustment (balance may go
   negative); the return is never blocked.
7. **Reverse a redemption (US4/US5)**: coupon returns to `issued`; money/stock effect reverses.

## Test strategy (Constitution Principle X — test-first)

Write these **failing** before implementing.

### Unit (critical paths)

- `test_point_balance.py` — balance = Σ point_record.delta after earn/reverse/converted/void_reclaim/
  adjustment; **balance may go negative**; no stored balance column.
- `test_coupon_serial_unique.py` — issued serials are unique; collision/concurrent issuance rejected.
- `test_money_coupon_ledger.py` — money & gift-money-off post ONE balanced entry (debit loyalty_expense,
  credit customer_receivable); Σdebit=Σcredit; gift-product posts **no** ledger entry.
- `test_redemption_reversal.py` — every redemption reversible, reverse-once; reversal returns coupon to
  issued; a coupon redeems at most once.

### Integration (journeys)

- Earn-on-sale via the 002 hook (3 × 5 = 15) and proportional reversal on a partial return.
- Convert: whole coupons only; insufficient/partial rejected; remainder stays as balance.
- Redeem money/gift-product/gift-money-off; standalone vs on-invoice; gift-product no-negative-stock.
- **Return-after-consumption hybrid**: (a) unredeemed funded coupon → voided + reclaim; (b) already
  redeemed → negative adjustment; return never blocked.
- Ledger-derived: loyalty_expense + receivable balances equal Σ ledger lines after the flow.

### Contract

- New endpoints in `/openapi.json`; the 001+002 contract-drift gate still passes (additive only).

### Migration

- `alembic upgrade head` → `downgrade` → `upgrade` clean on MySQL; `loyalty_expense` enum value +
  `point_record` triggers present; a live UPDATE/DELETE on a `point_record` is rejected by trigger.

### Tooling

- `pytest -q`; points are integers, money/qty use `Decimal`. Reuse 001/002 fixtures + add customer/
  product/coupon-type factories.
