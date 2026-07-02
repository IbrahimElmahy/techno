# Tasks: Customer Credit Limit & Due-Term Enforcement (012)

**Additive on 002; builds on the 0010 migration head. Money `MONEY` DECIMAL(18,2); term INT; due DATE.**

## Foundational (models, capability, service skeletons)

- [x] T001 [impl] Extend `src/models/customer.py` `Customer`: +`credit_limit` (MONEY nullable),
  +`max_due_term_days` (Integer nullable) — data-model; research R1
- [x] T002 [impl] Extend `src/models/sales.py` `SalesInvoice`: +`due_date` (Date nullable) — R5
- [x] T003 [impl] `src/auth/rbac.py`: `CAP_SELL_OVER_CREDIT_LIMIT = "sell.over_credit_limit"`; grant to
  system_admin, branch_manager, sales_manager; add to ALL_CAPABILITIES — R4; FR-009
- [x] T004 [impl] `src/services/credit_report.py`: `exposure(db)` + `overdue(db, as_of)` — R6

---

## US1 — Master data (P1)

- [x] T005 [test] `tests/integration/test_customer_credit_fields.py`: set/clear credit_limit &
  max_due_term_days via API; round-trip on GET — FR-001; SC-001
- [x] T006 [impl] `src/api/customers.py`: `credit_limit`/`max_due_term_days` on customer create/update/out

**Checkpoint**: limits stored & returned.

---

## US2 — Amount enforcement + override (P1)

- [x] T007 [test] `tests/unit/test_credit_limit_guard.py`: outstanding 800 + credit 300 vs limit 1000 →
  blocked; ==1000 allowed; cash-only allowed; null limit allowed; override allowed — FR-002/003/004; SC-002
- [x] T008 [impl] `src/services/sales_service.py`: `CreditLimitError(SalesError)`; in `create_sale`, when
  `credit_amount > 0` and `customer.credit_limit` non-null and not `can_over_credit_limit`, reject if
  `balance_of(receivable) + credit_amount > credit_limit` — FR-002/003
- [x] T009 [impl] `src/api/sales.py`: resolve `can_over_credit_limit` from capability; map
  `CreditLimitError` → 409 `credit_limit_exceeded` — FR-002

**Checkpoint**: over-limit credit sales blocked; override & cash bypass.

---

## US3 — Due-term enforcement + due_date (P2)

- [x] T010 [test] `tests/unit/test_due_term_guard.py`: due_term 45 vs max 30 → blocked; 30 → allowed +
  due_date = today+30; cash-only ignores term — FR-005/006; SC-003
- [x] T011 [impl] `src/services/sales_service.py`: `create_sale` +`due_term_days` param; `DueTermError`;
  reject when `due_term_days > max_due_term_days`; stamp `due_date` for credit sales — FR-005/006
- [x] T012 [impl] `src/api/sales.py`: `SaleCreate` +`due_term_days`; pass through; map `DueTermError` → 409

**Checkpoint**: term breaches blocked; due_date stamped.

---

## US4 — Reports (P2)

- [x] T013 [test] `tests/integration/test_credit_reports.py`: exposure lists limit/outstanding/available/
  over_limit; overdue lists past-due unsettled invoices — FR-007/008; SC-004
- [x] T014 [impl] `src/api/reports.py`: `GET /reports/credit-exposure`, `GET /reports/overdue?as_of=` —
  contracts; FR-007/008

**Checkpoint**: exposure & overdue reports work.

---

## Cross-cutting — migration, contract gate, frontend

- [x] T015 [impl] Alembic `0011_credit_limits` (down_revision `0010_limits_batches`): ALTER customer ADD
  credit_limit/max_due_term_days; ALTER sales_invoice ADD due_date; additive, no backfill — R7
- [x] T016 [test] `tests/integration/test_migration_additive_012.py`: down_revision `0010_limits_batches`;
  customer has credit_limit/max_due_term_days; sales_invoice has due_date
- [x] T017 [impl] Extend `scripts/check_contract_drift.py` with the 012 contract; 001–011 gate stays green
- [x] T018 [test] `tests/contract/test_credit_limits_contract.py`: `/reports/credit-exposure` +
  `/reports/overdue` present; customer schema exposes credit_limit/max_due_term_days
- [x] T019 [impl] `frontend/src/pages/Customers.tsx`: credit_limit + max_due_term_days on create/edit
- [x] T020 [impl] `frontend/src/pages/Invoices.tsx`: due_term_days on a credit sale; surface 409 messages
- [x] T021 [impl] `frontend/src/pages/Reports.tsx`: credit-exposure + overdue tables; `tsc --noEmit` clean

## Dependencies
- T001–T004 → everything. T007→T008; T010→T011. T008 (guard) before T009 (API). Reports (T014) need
  T004. Migration/contract/frontend last.
