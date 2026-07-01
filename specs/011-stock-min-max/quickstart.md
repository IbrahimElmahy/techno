# Quickstart: Stock Min/Max Limits & Expiry Batches

## 0. Migrate
```bash
cd backend && alembic upgrade head   # 0010_limits_batches: item min/max/is_perishable + stock_batch
```

## 1. Min/max + reorder report
```bash
curl -XPATCH -H "Authorization: Bearer $JWT" /api/v1/items/<id> -d '{"min_stock":"10","max_stock":"100"}'
curl -H "Authorization: Bearer $JWT" /api/v1/stock/reorder
# → items with total on-hand < min (below_min) or > max (above_max)
```
Limits are advisory — they never block a sale.

## 2. Perishable batches (receive + FEFO sale)
```bash
curl -XPATCH -H "Authorization: Bearer $JWT" /api/v1/items/<id> -d '{"is_perishable":true}'
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/items/<id>/batches/receive -d '{
  "location_kind":"warehouse","location_id":1,"expiry_date":"2026-06-30","quantity":"5"}'
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/items/<id>/batches/receive -d '{
  "location_kind":"warehouse","location_id":1,"expiry_date":"2026-12-31","quantity":"10"}'
# sell 7 → the 2026-06-30 batch empties (5), 2 taken from 2026-12-31; on-hand 8
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/sales -d '{ ... "lines":[{"item_id":<id>,"quantity":"7"}] }'
curl -H "Authorization: Bearer $JWT" /api/v1/items/<id>/batches   # remaining lots
```

## 3. Expiring report + perishable return
```bash
curl -H "Authorization: Bearer $JWT" "/api/v1/stock/expiring?before=2026-07-01"
# return restores to a batch at the given expiry:
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/sales/<sale_id>/returns -d '{
  "lines":[{"item_id":<id>,"quantity":"1","expiry_date":"2026-12-31"}]}'
```

## 4. Tests
```bash
cd backend
pytest tests/unit/test_reorder_report.py tests/unit/test_batch_fefo.py tests/unit/test_batch_return.py \
       tests/integration/test_batches_api.py tests/integration/test_perishable_sale_flow.py
python scripts/check_contract_drift.py
```

## Invariants
- Batch-quantity sum at a location == on-hand of that perishable item there.
- FEFO: earliest expiry consumed first; perishable sells in the base unit.
- Min/max advisory (never block); only No-Negative-Stock blocks.
- Money/ledger and 002/007/008/009 flows unchanged.
