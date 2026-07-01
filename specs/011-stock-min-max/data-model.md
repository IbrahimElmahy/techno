# Phase 1 Data Model: Stock Min/Max Limits & Expiry Batches

Additive to 002. **Three item columns** + **one new table**. Batch moves are paired with 002 quantity
movements so on-hand == batch sum for perishable items.

## Extended: `item` (002)
| Column | Type | Notes |
|---|---|---|
| **min_stock** | QTY NULL | advisory reorder floor (base units) |
| **max_stock** | QTY NULL | advisory overstock ceiling (base units) |
| **is_perishable** | Boolean default false | when true, batch-tracked by expiry |

## New entity: `stock_batch`
| Column | Type | Notes |
|---|---|---|
| id | BigIntPK | |
| item_id | BigInteger FK→item.id, indexed | |
| location_kind | Enum(LocationKind) | warehouse \| custody |
| location_id | BigInteger | |
| expiry_date | Date | |
| quantity | QTY | remaining, base units (≥ 0) |
| — | index (item_id, location_kind, location_id, expiry_date) | FEFO + upsert lookup |

## Service surface
- `stock_report.reorder(db)` → list of `{item_id, code, name, on_hand, min_stock, max_stock, flag}` where
  flag ∈ {below_min, above_max} (item-total on-hand).
- `batch_service.receive(db, item, location, expiry_date, quantity, actor)` → upsert batch + stock-in.
- `batch_service.assert_base_unit(item, unit_factor)` → reject alternate unit for perishable.
- `batch_service.consume_fefo(db, item, location, quantity)` → deplete earliest-expiry batches; raise on
  shortfall.
- `batch_service.restore_for_return(db, item, location, expiry_date, quantity)` → upsert batch (+qty).
- `batch_service.expiring(db, before, item_id=None)` → batches with expiry ≤ before and qty > 0.

## Sales integration
- `create_sale`: for a perishable item line, `assert_base_unit` (pre) then the existing stock-out (which
  enforces No-Negative), then `consume_fefo` (deplete batches). All in one transaction.
- `return_sale`: `ReturnLine` gains an optional `expiry_date`; for a perishable item, required →
  `restore_for_return` (after the existing stock-in).

## Invariant (FR-007)
```text
receive N@exp  →  +N stock-in  + batch(exp) += N
sell    N      →  −N stock-out + FEFO deplete N (earliest expiry first)   [base unit only]
return  N@exp  →  +N stock-in  + batch(exp) += N
⇒ Σ batch.quantity @loc == on_hand(item, loc)   for perishable items
```

## Validation summary (test-first)
| Rule | Where | Test |
|---|---|---|
| reorder classifies below_min / above_max; limits never block | stock_report / sale | test_reorder_report |
| batch receive: perishable only; +N stock; batch upsert | batch_service.receive | test_batches_api |
| FEFO: earliest expiry consumed first; base unit only; shortfall rejected | batch_service.consume_fefo + sales | test_batch_fefo |
| return restores to expiry batch; missing expiry rejected | batch_service.restore_for_return | test_batch_return |
| expiring report ≤ cutoff, qty > 0, earliest first | batch_service.expiring | test_batches_api |
| batch sum == on-hand | end-to-end | test_perishable_sale_flow |

## ER (additive)
```text
item (1) ──< stock_batch (item_id, location, expiry_date, quantity)   # lots by expiry
item ── min_stock/max_stock/is_perishable                              # advisory limits + flag
```
