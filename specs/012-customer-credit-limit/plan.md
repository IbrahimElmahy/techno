# Implementation Plan: Customer Credit Limit & Due-Term Enforcement (012)

**Branch**: `012-customer-credit-limit` · **Spec**: [spec.md](spec.md) · **Additive on**: 002 (sales,
customer, ledger), builds on the 0010 migration head.

## Summary

Add per-customer `credit_limit` (money) and `max_due_term_days` (int) master data, a `due_date` on the
sales invoice, and enforce both at credit-sale time inside `sales_service.create_sale` — using the
**ledger-derived** receivable balance (no stored balance). An override capability
`sell.over_credit_limit` bypasses only the amount ceiling. Two read-only reports (credit-exposure,
overdue) expose the derived state. Everything is additive; migration `0011_credit_limits` chains onto
`0010_limits_batches`.

## Technical Context

- **Language/deps**: Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused (001–011).
- **Money/int**: `credit_limit` via shared `MONEY` DECIMAL(18,2); `max_due_term_days` INT; `due_date` DATE.
- **Balance source**: `ledger_service.balance_of(receivable_account_id)` (Principle III — derived).
- **Enforcement point**: `create_sale`, after the net split is validated and before/at posting, so a
  rejection raises `SalesError` (→ 409 at the API) and nothing is persisted.
- **RBAC**: `CAP_SELL_OVER_CREDIT_LIMIT = "sell.over_credit_limit"`, granted to system_admin,
  branch_manager, sales_manager (mirrors `sell.below_price`).

## Constitution Check

- **II Additive-only**: new columns + one new migration; no 001–011 table dropped/redefined. ✅
- **III Derived balances**: receivable read via `balance_of`; no balance column added. ✅
- **X RBAC deny-by-default**: override capability defaults off; only three roles get it. ✅
- **XI No-Negative-Stock**: unchanged; credit enforcement is orthogonal to stock. ✅
- Immutable ledger: unchanged — this feature never writes/edits ledger lines beyond the existing sale
  entry. ✅

No violations; no complexity deviations.

## Project Structure (this feature)

```
backend/src/
  models/customer.py         # +credit_limit, +max_due_term_days
  models/sales.py            # +due_date
  auth/rbac.py               # +CAP_SELL_OVER_CREDIT_LIMIT (+grants)
  services/sales_service.py  # enforce limit + term; stamp due_date
  services/credit_report.py  # NEW: exposure() + overdue()
  api/customers.py           # customer create/update/out gain the two fields
  api/sales.py               # SaleCreate +due_term_days; pass override flag
  api/reports.py             # GET /reports/credit-exposure, GET /reports/overdue
migrations/versions/0011_credit_limits.py   # additive
tests/                       # unit + integration + migration + contract
frontend/src/pages/          # Customers, Invoices, Reports
```

## Phasing

1. **US1** master data (columns + API round-trip).
2. **US2** amount enforcement + override (the core invariant).
3. **US3** due-term enforcement + due_date stamping.
4. **US4** reports.
5. Migration + contract gate + frontend.
