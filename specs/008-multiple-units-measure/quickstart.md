# Quickstart: Multiple Units of Measure

## 0. Migrate
```bash
cd backend && alembic upgrade head   # 0007_item_units: item_unit + unit/unit_factor on sales & purchase lines
```

## 1. Define an item's units
```bash
# base unit is the item's unit_of_measure (e.g. piece, factor 1); add alternates:
curl -XPUT -H "Authorization: Bearer $JWT" /api/v1/items/<id>/units -d '{"units":[
  {"name":"كرتونة","factor":"12.000"},
  {"name":"دستة","factor":"12.000"}]}'
curl -H "Authorization: Bearer $JWT" /api/v1/items/<id>/units   # → base + alternates
```
Duplicate name or factor ≤ 0 → 422.

## 2. Sell in a unit
```bash
# sell 2 cartons (factor 12) → stock −24 base; price defaults to base-tier × 12
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/sales -d '{
  "customer_id":<id>,"origin":{"location_kind":"warehouse","location_id":1},
  "cash_amount":"...","credit_amount":"...",
  "lines":[{"item_id":<id>,"quantity":"2","unit":"كرتونة"}]}'
```
On-hand drops by 24 base units; the line records unit="كرتونة", unit_factor=12.

## 3. Buy in a unit
```bash
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/purchases -d '{
  "supplier_id":<id>,"location":{"location_kind":"warehouse","location_id":1},
  "cash_amount":"...","credit_amount":"...",
  "lines":[{"item_id":<raw>,"quantity":"1","unit":"كرتونة","unit_price":"600"}]}'
# stock +12 base units
```

## 4. Tests
```bash
cd backend
pytest tests/unit/test_uom_resolution.py tests/unit/test_unit_stock_conversion.py \
       tests/unit/test_unit_price_factor.py tests/integration/test_item_units_api.py \
       tests/integration/test_sale_purchase_units.py tests/integration/test_unit_return.py
python scripts/check_contract_drift.py
```

## Invariants
- Stock is always base units (qty × factor); on-hand + No-Negative-Stock in base units.
- No unit ⇒ base (factor 1) — 002/007 unchanged.
- Sale price defaults to base-tier × factor; below it still needs sell.below_price (007).
- Returns reverse qty × line factor (stock) and qty × line price (money) from the snapshot.
