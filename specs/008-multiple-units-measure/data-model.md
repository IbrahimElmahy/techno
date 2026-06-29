# Phase 1 Data Model: Multiple Units of Measure

Additive to 002/007. **One new table** + **two nullable columns on each of two line tables**. Stock stays
in base units; the base unit is `item.unit_of_measure` (implicit factor 1).

## New entity: `item_unit`

| Column | Type | Notes |
|---|---|---|
| id | BigIntPK | |
| item_id | BigInteger FK→item.id, indexed | |
| name | String(16) | alternate unit name (e.g. كرتونة) |
| factor | QTY (Numeric(18,3)) > 0 | base units per one of this unit |
| — | UNIQUE(item_id, name) | unique per item; must also differ from the base unit name |

## Extended: `sales_invoice_line` (002/007)

| Column | Type | Notes |
|---|---|---|
| quantity | QTY | entered quantity **in the chosen unit** (unchanged column, new meaning when unit set) |
| unit_price | MONEY | per the chosen unit (was per base) |
| **unit** | String(16) NULL | chosen unit name; NULL = base |
| **unit_factor** | QTY default 1 | factor snapshot (base = 1) |

## Extended: `purchase_invoice_line` (002)

| Column | Type | Notes |
|---|---|---|
| quantity | QTY | entered quantity in the chosen unit |
| **unit** | String(16) NULL | chosen unit name; NULL = base |
| **unit_factor** | QTY default 1 | factor snapshot |

## Service surface (additive)

- `uom_service.resolve_factor(db, item, unit)` → Decimal (base/None=1; alt=row.factor; else `UomError`).
- `sales_service.SaleLine` gains `unit`; per line: `factor=resolve_factor`; `base_qty=qty×factor` →
  stock; `list_price = base_tier_price(007) × factor`; `unit_price = override or list_price`; below-price
  check vs `list_price`; line snapshots `unit`/`unit_factor`.
- `purchase_service.PurchaseLine` gains `unit`; `base_qty=qty×factor` → stock; line snapshots unit/factor.
- Returns: stock reverse `qty × line.unit_factor`; money reverse `qty × line.unit_price`.

## Conversion (per line)

```text
factor   = resolve_factor(item, unit)        # base/None → 1
base_qty = entered_qty × factor              # → stock_service (002, unchanged)
list     = base_tier_price(007) × factor     # sales only
price    = override or list                  # below `list` needs sell.below_price (007)
line: quantity=entered_qty, unit, unit_factor=factor, unit_price=price
```

## Validation summary (test-first)

| Rule | Where | Test |
|---|---|---|
| unique unit name; factor > 0 | item_unit / catalog api | test_item_units_api |
| factor resolution (base/alt/unknown) | uom_service | test_uom_resolution |
| stock posts qty × factor (base) | sales/purchase service | test_unit_stock_conversion |
| default price = base-tier × factor; below uses base×factor | sales service | test_unit_price_factor |
| return reverses qty × factor / qty × price | sales/purchase service | test_unit_return |
| no unit ⇒ base (002/007 unchanged) | services | test_sale_purchase_units |

## ER (additive)

```text
item (1) ──< item_unit (item_id, name)         # alternate units; base implicit (factor 1)
sales_invoice_line ── unit, unit_factor         # snapshot
purchase_invoice_line ── unit, unit_factor      # snapshot
```
