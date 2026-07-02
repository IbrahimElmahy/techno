# Quickstart: Customer Credit Limit & Due-Term (012)

Prereq: 001–011 applied; a customer with a linked receivable account; an origin location with stock.

1. **Set limits** — `PATCH /api/v1/customers/{id}` with `{ "credit_limit": "1000.00",
   "max_due_term_days": 30 }`. They round-trip on `GET /api/v1/customers/{id}`.
2. **Credit sale under the limit** — a credit sale whose `credit_amount` keeps
   `outstanding + credit ≤ 1000` posts normally.
3. **Credit sale over the limit** — the same customer already owing 800, a credit sale adding 300 →
   **409** `credit_limit_exceeded` — unless the actor is system_admin / branch_manager / sales_manager
   (holds `sell.over_credit_limit`), who may override.
4. **Cash sale** — a cash-only sale (credit_amount 0) is never blocked.
5. **Due-term** — a credit sale with `due_term_days: 45` against `max_due_term_days: 30` → **409**
   `due_term_exceeded`; with `30` → posts and stamps `due_date = today + 30`.
6. **Reports** — `GET /api/v1/reports/credit-exposure` lists each limited customer's limit / outstanding /
   available / over_limit; `GET /api/v1/reports/overdue?as_of=2026-12-31` lists past-due credit invoices.

Full flow is covered by `tests/integration/test_credit_limit_flow.py` and
`tests/integration/test_credit_reports.py`.
