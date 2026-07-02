# Research: Customer Credit Limit & Due-Term Enforcement (012)

- **R1 — Where to store the limits.** On `customer` (master data), nullable. `credit_limit` uses the
  shared `MONEY` type; `max_due_term_days` is a plain nullable INT. Null = "no cap" so existing customers
  need no backfill (additive, Principle II).

- **R2 — Outstanding balance is derived, never stored.** The customer's receivable is
  `ledger_service.balance_of(customer.account.account_id)` — the linked receivable account, whose
  `normal_side` is debit, so a positive balance = amount owed to us. This honours Principle III and means
  returns/payments already restore available credit with no extra code.

- **R3 — Enforcement point.** Inside `create_sale`, after computing `net` and validating the cash/credit
  split, before posting movements/ledger. The credit portion is `credit_amount` (already the amount going
  to receivable). Check `balance_of(...) + credit_amount > credit_limit`. Equality allowed (ceiling
  reached is OK). Raising `SalesError` there aborts the transaction cleanly (API maps to 409). The API
  currently maps `SalesError` → 422; for credit/term rejections we surface **409** (a conflict with
  business state) to match the No-Negative-Stock style — done by raising a dedicated `CreditLimitError`
  subclass the API catches and returns 409.

- **R4 — Override capability.** `sell.over_credit_limit`, mirroring `sell.below_price` (007). Granted to
  system_admin, branch_manager, sales_manager; **not** sales_rep. The API resolves
  `role_has_capability(role, CAP_SELL_OVER_CREDIT_LIMIT)` and passes `can_over_credit_limit` into
  `create_sale`. The override bypasses **only** the amount ceiling — the due-term cap is a hard policy
  (no override), because a term breach is a data-entry error, not a credit judgement.

- **R5 — Due-term & due_date.** `SaleCreate` gains an optional `due_term_days` (int ≥ 0). For a credit
  sale, if the customer's `max_due_term_days` is non-null and `due_term_days > max`, reject. On success,
  `due_date = today + due_term_days` is stamped on the invoice. Cash-only sales ignore the term entirely
  (no due_date). "today" is `date.today()` at post time; the overdue report accepts an optional `as_of`
  date to keep tests deterministic.

- **R6 — Reports (derived, read-only).** `credit_report.exposure(db)` iterates customers with a non-null
  `credit_limit`, computing outstanding via `balance_of`, `available = limit - outstanding`, and
  `over_limit = outstanding > limit`. `credit_report.overdue(db, as_of)` lists sales invoices with
  `due_date < as_of` whose customer still carries a positive receivable (approximates "unsettled" without
  a per-invoice settlement ledger — acceptable for this feature's scope). Both use `reports.read`
  (CAP_SALES_READ).

- **R7 — Migration.** `0011_credit_limits`, down_revision `0010_limits_batches`: `ALTER customer ADD
  credit_limit MONEY NULL, ADD max_due_term_days INT NULL`; `ALTER sales_invoice ADD due_date DATE NULL`.
  Additive, no backfill, no redefinition.

- **R8 — DB-agnostic.** SQLite (tests/dev) and Postgres/Neon (hosted via create_all) both get the columns
  from the model; MySQL gets them from the Alembic migration. `MONEY`/DATE/INT are portable.
