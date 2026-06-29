# Quickstart: Cost Centers (Analytical Dimension)

Back-office (Accountant / System Admin) walkthrough. Assumes 005 is migrated and an Accountant JWT.

## 0. Migrate

```bash
cd backend
alembic upgrade head        # applies 0005_cost_centers (additive: cost_center table + ledger_line.cost_center_id)
```

## 1. Build the cost-center master

```bash
# a root cost center
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/cost-centers \
  -d '{"code":"1","name":"الفروع"}'
# a child under it
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/cost-centers \
  -d '{"code":"1.01","name":"معرض مدينة نصر","parent_id":<root_id>}'
curl -H "Authorization: Bearer $JWT" "/api/v1/cost-centers?tree=true"
```

Duplicate code → 409; unknown parent → 409.

## 2. Post a journal entry with a cost center on a line

```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/journal-entries \
  -d '{"date":"2026-06-29","description":"إيجار المعرض","branch_id":1,"lines":[
        {"account_id":<rent>,"direction":"debit","amount":"5000.00","cost_center_id":<nasr_id>},
        {"account_id":<treasury>,"direction":"credit","amount":"5000.00"}]}'
```

The first line is tagged with the cost center; the second is untagged. The entry still balances.
A line referencing a **deactivated/unknown** cost center → 422.

## 3. Reverse — the cost center is carried

```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/journal-entries/<id>/reverse
# the mirrored debit/credit carry the same cost_center_id, so the cost center nets to zero
```

## 4. Trial balance filtered by cost center

```bash
curl -H "Authorization: Bearer $JWT" \
  "/api/v1/trial-balance?from=2026-01-01&to=2026-12-31&cost_center_id=<nasr_id>"
```

Only lines tagged with that cost center are aggregated. Omit `cost_center_id` → the report is exactly as
before this feature (no change).

## 5. Deactivate (never hard-delete)

```bash
curl -XDELETE -H "Authorization: Bearer $JWT" /api/v1/cost-centers/<id>
# a used cost center is deactivated, not removed; historical lines keep their tag
```

## 6. Tests

```bash
cd backend
pytest tests/unit/test_cost_center_master.py tests/unit/test_journal_cost_center.py \
       tests/unit/test_cost_center_reversal_copy.py \
       tests/integration/test_cost_centers_api.py tests/integration/test_trial_balance_cost_center.py
python scripts/check_contract_drift.py
```

## Invariants

- One ledger: the cost center is an optional line attribute; balances/figures stay derived.
- Optional everywhere: untagged lines and 001/002/003 posts are unaffected.
- Reversal copies the cost center; master is deactivated, never deleted.
- Unfiltered trial balance is unchanged (no regression).
