# Quickstart: Serial Numbers per Item

## 0. Migrate
```bash
cd backend && alembic upgrade head   # 0008_serials: item.is_serialized + item_serial table
```

## 1. Mark an item serialized + receive serials
```bash
curl -XPATCH -H "Authorization: Bearer $JWT" /api/v1/items/<id> -d '{"is_serialized":true}'
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/items/<id>/serials/receive -d '{
  "location_kind":"warehouse","location_id":1,"serials":["SN-1","SN-2","SN-3"]}'
# on-hand of <id> at warehouse 1 is now 3; the three serials are in_stock
curl -H "Authorization: Bearer $JWT" "/api/v1/items/<id>/serials?status=in_stock"
```
A duplicate serial for the item, or a non-serialized item → 422.

## 2. Sell specific serials
```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/sales -d '{
  "customer_id":<id>,"origin":{"location_kind":"warehouse","location_id":1},
  "cash_amount":"...","credit_amount":"...",
  "lines":[{"item_id":<id>,"quantity":"2","serials":["SN-1","SN-2"]}]}'
# SN-1, SN-2 → sold; on-hand drops by 2
```
count ≠ quantity, a serial not in stock at the origin, an alternate unit, or serials on a non-serialized
line → rejected.

## 3. Return serials
```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/sales/<sale_id>/returns -d '{
  "lines":[{"item_id":<id>,"quantity":"1","serials":["SN-1"]}]}'
# SN-1 → in_stock at the origin; on-hand rises by 1
```

## 4. Tests
```bash
cd backend
pytest tests/unit/test_serial_receive.py tests/unit/test_serial_sale_guards.py \
       tests/unit/test_serial_return.py tests/integration/test_serials_api.py \
       tests/integration/test_serial_sale_flow.py
python scripts/check_contract_drift.py
```

## Invariants
- In-stock serial count at a location == on-hand of that serialized item there.
- Serials only for serialized items; one serial = one base unit.
- Sale marks serials sold; return restores invoice-sold serials; money/ledger unchanged.
