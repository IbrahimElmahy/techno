# Quickstart: Five Sale Price Tiers

Back-office walkthrough. Assumes 002 is live and a manager/admin JWT.

## 0. Migrate

```bash
cd backend
alembic upgrade head    # 0006_price_tiers: item_price table + customer.default_price_tier + sales_invoice_line.price_tier
```

## 1. Set an item's five tier prices

```bash
curl -XPUT -H "Authorization: Bearer $JWT" /api/v1/items/<product_id>/prices -d '{"tiers":[
  {"tier":"commercial","price":"100.00"},
  {"tier":"semi_commercial","price":"110.00"},
  {"tier":"wholesale","price":"90.00"},
  {"tier":"semi_wholesale","price":"95.00"},
  {"tier":"consumer","price":"130.00"}]}'
curl -H "Authorization: Bearer $JWT" /api/v1/items/<product_id>/prices
```

A tier left unset falls back to the item's base `sale_price`.

## 2. Give a customer a default tier

```bash
curl -XPATCH -H "Authorization: Bearer $JWT" /api/v1/customers/<id> \
  -d '{"default_price_tier":"wholesale"}'
```

## 3. Sell — default tier pre-fills, override per line

```bash
# line with no tier → uses the customer's default (wholesale = 90.00)
curl -XPOST -H "Authorization: Bearer $JWT" /api/v1/sales -d '{
  "customer_id":<id>,"origin":{"location_kind":"warehouse","location_id":1},
  "cash_amount":"90.00","credit_amount":"0.00",
  "lines":[{"item_id":<product_id>,"quantity":"1"}]}'

# line overriding the tier to consumer (130.00)
... "lines":[{"item_id":<product_id>,"quantity":"1","tier":"consumer"}] ...
```

The invoice line records `price_tier` (resolved) and `unit_price` (actual charged).

## 4. Below-price control

```bash
# manual price below the wholesale tier (90.00):
... "lines":[{"item_id":<product_id>,"quantity":"1","unit_price":"80.00"}] ...
# → 422 for a Sales Rep (no sell.below_price); 201 for a Manager/Admin (has the capability)
# a price >= the tier price is always allowed for anyone.
```

## 5. Tests

```bash
cd backend
pytest tests/unit/test_tier_resolution.py tests/unit/test_sell_below_price.py \
       tests/integration/test_item_prices_api.py tests/integration/test_customer_default_tier.py \
       tests/integration/test_sale_with_tiers.py
python scripts/check_contract_drift.py
```

## Invariants

- Tiers only set the line price; discount, cash/credit split, and the one balanced ledger entry are
  exactly as in 002.
- A missing tier falls back to the base `sale_price` (no 002 regression).
- The line snapshots the tier + actual price; later edits never change posted lines.
- Below-tier selling needs `sell.below_price`; at/above is always allowed.
