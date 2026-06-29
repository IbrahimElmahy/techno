# Quickstart: Sales & Inventory (extends Foundation)

## Prerequisites

- Foundation (001) implemented; `backend/` venv and DB already set up.
- Apply the additive migration: `cd backend && alembic upgrade head` (brings the schema to
  `0002_sales_inventory`: new account-enum values + new tables + stock immutability triggers).
- Reuse the same `.env` / `DATABASE_URL`. Tests run on SQLite in-memory; the migration check runs on
  MySQL/MariaDB.

## Smoke flow (maps to acceptance scenarios)

1. **Catalog (US1/US2)**: create a raw material (kg) and a product (piece, sale_price 100).
2. **Purchase (US1)**: supplier + purchase 100 kg into Central — `cash 400 / credit 600` of total
   1000 → supplier payable rises 600, on-hand(raw, Central) = 100.
3. **Manufacture (US3)**: consume 30 kg at Central (on-hand 70), separately produce 10 product at
   Central (product on-hand 10) — two independent ops.
4. **Transfer (US5)**: central→rep 5 product, Branch Manager approves → Central 5, rep custody 5.
5. **Sale (US4)**: rep sells 3 product to own customer; gross 300, fixed 5% + variable 10% = 15% →
   net 255; cash 100 / credit 155 → rep custody +100, customer receivable +155, sales_revenue 255;
   rep custody on-hand 2.
6. **Returns (US6)**: return 1 product → stock back, proportional money reversal; a second return
   exceeding remaining is rejected.
7. **No-negative-stock**: any sale/consume/transfer beyond on-hand → 409.

## Test strategy (Constitution Principle X — test-first)

Write these **failing** before implementing the corresponding service.

### Unit (the five critical paths)

- `test_stock_no_negative.py` — an `out` movement exceeding on-hand is rejected; equal-to is allowed;
  concurrent two-writer case cannot both pass (locator lock).
- `test_on_hand_derivation.py` — on-hand = Σ(in − out) after a mixed sequence incl. a reversal; no
  stored on-hand column exists.
- `test_movement_reversal.py` — every movement type has a mirror reversal (in↔out) linked via
  `reverses_movement_id`; reverse-once enforced; original immutable (UPDATE/DELETE rejected).
- `test_discount_math.py` — `combined = fixed+variable` applied once to gross; net rounding 2dp;
  variable-only and zero-discount cases; no amount-based path.
- `test_sale_ledger_balance.py` — a split sale posts ONE balanced entry: debit cash-location +
  customer_receivable, credit sales_revenue; Σdebit=Σcredit; rep sale debits the **rep custody**
  account, branch sale debits branch treasury/custody.

### Integration (journeys)

- Purchase with supplier credit → payable balance + raw on-hand; partial purchase return proportional.
- Manufacturing consume/produce independence (no linkage; each reversible).
- Sale end-to-end for a rep (own customer, own custody origin), printable payload, scope denials for
  cross-rep/cross-branch.
- Transfer pending→approve (only Branch Manager) → atomic out+in; reverse-transfer; illegal route 422.
- Partial sales return: cumulative ≤ sold; over-return rejected; each return reversible.
- Ledger-derived balances (treasury/custody/customer/supplier) equal Σ ledger lines after the flow.

### Contract

- Extended endpoints validated against `contracts/openapi.yaml`; FastAPI `/openapi.json` includes the
  new paths; the Foundation contract-drift gate still passes (additive only).

### Migration

- `alembic upgrade head` then `downgrade` then `upgrade` is clean on MySQL; the new account-enum values
  and `stock_movement` triggers exist; a live UPDATE/DELETE on a stock movement is rejected by trigger.

### Tooling

- `pytest -q`; money/qty assertions use `Decimal`. New unit tests reuse Foundation's `db`/`client`/
  `world` fixtures plus added item/location fixtures.
