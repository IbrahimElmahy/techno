# Phase 1 Data Model: Five Sale Price Tiers

Additive to 002. **One new table** + **two nullable columns** + **one new enum** + **one capability**.
The base `item.sale_price` is retained as the fallback; the money/ledger model is untouched.

## New enum: `PriceTier`
`commercial | semi_commercial | wholesale | semi_wholesale | consumer`
(تجارى / نصف تجارى / جملة / نصف جملة / مستهلك). Labels are client-side.

## New entity: `item_price`

| Column | Type | Notes |
|---|---|---|
| id | BigIntPK | |
| item_id | BigInteger FK→item.id, indexed | |
| tier | Enum(PriceTier) | |
| price | MONEY (≥ 0) | the tier's sale price |
| — | UNIQUE(item_id, tier) | at most one price per item per tier |

**Rules**
- Setting/editing prices uses `catalog.write`.
- A missing (item, tier) row falls back to `item.sale_price` at resolution time.

## Extended entity: `customer` (002, +default_price_tier)

| Column | Type | Notes |
|---|---|---|
| … existing … | | unchanged |
| **default_price_tier** | Enum(PriceTier) NULL | NULL → resolves to `consumer`. Set via `customer.write`. |

## Extended entity: `sales_invoice_line` (002, +price_tier)

| Column | Type | Notes |
|---|---|---|
| … existing … | | unchanged |
| unit_price | MONEY | **now the actual charged price** (was the fixed sale price) |
| **price_tier** | Enum(PriceTier) NULL | the resolved tier snapshot (NULL for legacy 002 lines) |

## New capability

`sell.below_price` → granted to `system_admin`, `branch_manager`, `sales_manager` (NOT `sales_rep`).

## Service surface (additive)

- `pricing_service.resolve_tier(line_tier, customer)` → PriceTier (explicit → default → consumer).
- `pricing_service.tier_price(db, item, tier)` → Decimal (item_price row → fallback item.sale_price; else error).
- `sales_service.SaleLine` gains `tier: PriceTier | None` and `unit_price: Decimal | None`.
- `sales_service.create_sale(..., can_sell_below: bool)` — resolves price per line, enforces below-price,
  records `price_tier` + actual `unit_price`. All other math unchanged.

## Pricing resolution (per sale line)

```text
tier        = line.tier or customer.default_price_tier or consumer
tier_price  = item_price[(item, tier)] or item.sale_price   # else SalesError (no price)
actual      = line.unit_price if provided else tier_price
if actual < tier_price and not can_sell_below: reject (SalesError)
line.unit_price = actual ; line.price_tier = tier
# gross/discount/cash-credit/ledger/stock — unchanged from 002
```

## Validation summary (enforced server-side, test-first)

| Rule | Where | Test |
|---|---|---|
| five tier prices stored/retrieved; ≥ 0 | catalog api / item_price | test_item_prices_api |
| tier resolution explicit→default→consumer→base fallback | pricing_service | test_tier_resolution |
| editing tier never changes posted line | snapshot on line | test_sale_with_tiers |
| below-tier rejected w/o cap; allowed w/ cap; at/above always ok | sales_service | test_sell_below_price |
| customer default tier set/read; customer.write gate | customers api | test_customer_default_tier |
| discount/split/ledger unchanged from 002 | sales_service | test_sale_with_tiers |

## Entity relationship (additive view)

```text
item (1) ──< item_price (item_id, tier)   # ≤5 rows per item, unique per tier
customer (1) ── default_price_tier         # nullable enum column
sales_invoice_line ── price_tier           # nullable enum snapshot
```
