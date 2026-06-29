# Quickstart: General Ledger & Chart of Accounts

Back-office (Accountant / System Admin) walkthrough. Assumes 001/002/003 are migrated and a JWT for an
Accountant user is available. All money EGP `DECIMAL(18,2)`.

## 0. Migrate

```bash
cd backend
alembic upgrade head        # applies 0004_general_ledger (additive)
```

The migration: adds chart columns to `account`, adds `statement` to `ledger_line`, extends the
`AccountType` and `RoleName` enums, seeds the standard group headings, re-homes the seven system accounts
as postable leaves under their groups, seeds `opening_balance_equity`, and seeds the `accountant` role.

## 1. View the seeded chart

```bash
curl -H "Authorization: Bearer $JWT" "/api/v1/accounts?tree=true"
```

Expect a tree with group headings (Assets, Liabilities, Equity, Revenue, Cost & Expenses) and the system
accounts as postable leaves (Treasury, Custody, Receivables, Payables, Sales Revenue, Purchases Expense,
Loyalty Expense, Opening Balances Equity). All `is_system: true` leaves.

## 2. Build your own accounts

```bash
# a group under Expenses
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/accounts \
  -d '{"code":"5.02","name":"مصروفات إدارية","parent_id":<expenses_group_id>,"nature":"expense","is_postable":false}'
# a postable leaf under it
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/accounts \
  -d '{"code":"5.02.001","name":"إيجار","parent_id":<the_group_id>,"nature":"expense","is_postable":true}'
```

Rejections to expect: duplicate `code` → 409; `code` not prefixed by parent's code → 409; posting later to
the group `5.02` → 422.

## 3. Enter opening balances

```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/opening-balances \
  -d '{"date":"2026-01-01","lines":[
        {"account_id":<treasury>,"amount":"100000.00"},
        {"account_id":<receivables>,"amount":"25000.00"}]}'
```

Posts one balanced entry: debits Treasury + Receivables (asset normal side), credits
`opening_balance_equity` 125000.00.

## 4. Post a manual journal entry

```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/journal-entries \
  -d '{"date":"2026-06-28","description":"إيجار يونيو","branch_id":1,"lines":[
        {"account_id":<rent_leaf>,"direction":"debit","amount":"5000.00","statement":"إيجار المعرض"},
        {"account_id":<treasury>,"direction":"credit","amount":"5000.00"}]}'
```

Unbalanced or single-line or non-postable-account requests → 422.

## 5. Correct via reversal (never edit)

```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/journal-entries/<id>/reverse
# second call on the same id → 409 (reverse-once)
```

## 6. Trial balance

```bash
curl -H "Authorization: Bearer $JWT" \
  "/api/v1/trial-balance?from=2026-01-01&to=2026-06-30&include_groups=true"
```

Expect: per account opening / period_debit / period_credit / closing; group rows rolled up;
`grand_total_debit == grand_total_credit` and `balanced: true`. Add `&branch_id=1` to scope (admin omits
for all branches).

## 7. Run the tests

```bash
cd backend
pytest tests/unit/test_journal_balanced.py tests/unit/test_postable_only.py \
       tests/unit/test_account_code_hierarchy.py tests/unit/test_trial_balance_derivation.py \
       tests/unit/test_journal_reverse_once.py \
       tests/integration/test_chart_crud.py tests/integration/test_journal_post_api.py \
       tests/integration/test_opening_balances.py tests/integration/test_trial_balance_report.py
ruff check .
python scripts/check_contract_drift.py     # all 4 feature contracts vs /openapi.json
```

## Invariants this feature guarantees

- One ledger: a journal entry IS a `ledger_entry`; balances always = Σ lines.
- Postable-leaf-only posting; group nodes aggregate.
- Immutable + reverse-once corrections; full audit trail (inherited from Foundation).
- Company-wide chart; branch-tagged entries; trial balance filterable by branch.
- Trial balance grand totals always equal.
