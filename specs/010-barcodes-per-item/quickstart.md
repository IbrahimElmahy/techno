# Quickstart: Barcodes per Item

## 0. Migrate
```bash
cd backend && alembic upgrade head   # 0009_barcodes: item_barcode table
```

## 1. Assign barcodes (optionally per unit)
```bash
curl -XPUT -H "Authorization: Bearer $JWT" /api/v1/items/<id>/barcodes -d '{"barcodes":[
  {"barcode":"6221033000011"},
  {"barcode":"6221033000028","unit":"carton"}]}'
curl -H "Authorization: Bearer $JWT" /api/v1/items/<id>/barcodes
```
A barcode already used (any item) → 422; an unknown unit for the item → 422.

## 2. Scan / lookup
```bash
curl -H "Authorization: Bearer $JWT" /api/v1/barcodes/6221033000028
# → { item_id, code, name, unit: "carton", factor: "12.000", base_sale_price: "100.00" }
curl -H "Authorization: Bearer $JWT" /api/v1/barcodes/UNKNOWN   # → 404
```
The sale screen uses the result to add a line (item + unit) via the existing sale API.

## 3. Tests
```bash
cd backend
pytest tests/unit/test_barcode_rules.py tests/integration/test_barcodes_api.py
python scripts/check_contract_drift.py
```

## Invariants
- Barcode globally unique; a barcode resolves to exactly one item + unit.
- A per-unit barcode resolves to that unit's factor (008); base/none → 1.
- Lookup is read-only; all 002/007/008/009 flows unchanged.
