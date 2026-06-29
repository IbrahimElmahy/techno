# Phase 1 Data Model: Barcodes per Item

Additive to 002/008. **One new table.** The lookup reuses the 008 factor resolution.

## New entity: `item_barcode`
| Column | Type | Notes |
|---|---|---|
| id | BigIntPK | |
| item_id | BigInteger FK→item.id, indexed | |
| barcode | String(64) | **UNIQUE globally** |
| unit | String(16) NULL | the unit this barcode represents; NULL = base; alternate must be a defined item_unit |

## Service surface (`barcode_service`)
- `set_barcodes(db, item, [(barcode, unit), ...])` → validate (distinct in set; global unique; unit is
  base or a defined item_unit) then replace the item's barcode set.
- `lookup(db, barcode)` → `{item_id, code, name, unit, factor, base_sale_price}` or `None` (→ 404). Factor
  via `uom_service.resolve_factor(item, unit)`.

## Lookup resolution
```text
row   = item_barcode where barcode == code        # global unique; None → 404
item  = row.item
factor = uom_service.resolve_factor(item, row.unit)   # base/None → 1; alternate → its factor
→ { item_id, code, name, unit: row.unit, factor, base_sale_price: item.sale_price }
```

## Validation summary (test-first)
| Rule | Where | Test |
|---|---|---|
| barcode globally unique | barcode_service.set_barcodes | test_barcode_rules |
| unit must be base or a defined item_unit | barcode_service.set_barcodes | test_barcode_rules |
| lookup returns unit + factor; base→1 | barcode_service.lookup | test_barcode_rules |
| unknown barcode → 404 | api | test_barcodes_api |
| manage gated by catalog.write; lookup by catalog.read | api | test_barcodes_api |

## ER (additive)
```text
item (1) ──< item_barcode (item_id, barcode unique)   # barcode → item (+ unit)
item_barcode.unit ─→ item_unit.name (008) or base     # validated, factor resolved at lookup
```
