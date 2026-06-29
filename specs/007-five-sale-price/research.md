# Phase 0 Research: Five Sale Price Tiers

The three clarifications (default-from-customer + per-line override; below-price needs a capability;
price-tiers-only scope) were resolved in the 2026-06-29 session. Decisions below close the unknowns.

## R1 — Where the five tiers live

**Decision**: A new table `item_price(item_id FK, tier ENUM, price MONEY)` with a unique (item_id, tier).
The base `item.sale_price` is **kept** and used as the fallback when a tier row is absent.

**Rationale**: A keyed (item, tier) row makes "is this tier set?" unambiguous (row present or not) and lets
a missing tier fall back to the base price; it keeps the item lean and survives later tier relabel/extend.

**Alternatives rejected**: five fixed columns on `item` (0 vs unset ambiguity, item bloat, rigid);
migrating `sale_price` into a tier (no source data, breaks 002's single-price tests).

## R2 — The tier enum

**Decision**: `PriceTier` enum, fixed five values: `commercial`, `semi_commercial`, `wholesale`,
`semi_wholesale`, `consumer` (تجارى / نصف تجارى / جملة / نصف جملة / مستهلك). Labels are a client concern.

**Rationale**: Mirrors A5Group's named tiers exactly; a fixed enum is simplest and matches scope
(user-defined tiers are out of scope).

## R3 — Tier resolution + fallback (`pricing_service`)

**Decision**: `resolve_tier(line_tier, customer)` = `line_tier` if given, else `customer.default_price_tier`,
else `PriceTier.consumer`. `tier_price(db, item, tier)` = the `item_price` row's price if present, else
`item.sale_price` (base fallback); if neither exists → error (no price to charge).

**Rationale**: Pure, deterministic, one keyed lookup per line; backward-compatible (002 items with only
`sale_price` keep pricing). Centralised so the API can also expose a "price preview" later.

## R4 — Manual override + below-price control (`sales_service`)

**Decision**: `SaleLine` gains optional `tier: PriceTier | None` and `unit_price: Decimal | None`.
Per line, the service:
1. resolves the tier (R3) and the **tier price**;
2. the **actual price** = `unit_price` if provided, else the tier price;
3. if `actual < tier_price` → require the actor to hold `sell.below_price`, else raise `SalesError`;
   `actual >= tier_price` is always allowed;
4. records `price_tier` (resolved) and `unit_price` (actual) on the `SalesInvoiceLine`.

`create_sale` receives the actor's capability via a new `can_sell_below: bool` argument computed in the
router from `role_has_capability`. Gross/discount/split/ledger/stock are **unchanged** after the price is
chosen (Principle VI).

**Rationale**: Keeps the policy (capability) at the router boundary and the math in the service; the only
behavioural change is the per-line price source + one guard.

## R5 — Customer default tier

**Decision**: `customer.default_price_tier` nullable enum; `NULL` resolves to `consumer`. Exposed on the
customer create/update/detail payloads (set via existing `customer.write`).

**Rationale**: Minimal additive column; matches A5Group's per-customer default tier.

## R6 — Line snapshot

**Decision**: `sales_invoice_line.price_tier` (nullable enum) records the resolved tier; the existing
`unit_price` now stores the **actual** charged price. Editing item/customer prices later never touches
posted lines (snapshot), exactly like the existing `unit_price` snapshot.

**Rationale**: FR-002/007 — preserve history and enable tier-mix reporting.

## R7 — RBAC

**Decision**: New `CAP_SELL_BELOW_PRICE = "sell.below_price"`, granted to `system_admin`,
`branch_manager`, `sales_manager`. **Not** granted to `sales_rep` (reps cannot undercut tiers). Setting
tier prices reuses `catalog.write`; setting a customer default tier reuses `customer.write`.

**Rationale**: A real authority boundary expressed as one capability (deny-by-default); avoids per-user
flag sprawl.

## R8 — Migration

**Decision**: `0006_price_tiers.py` (down-revision `0005_cost_centers`):
1. `create_table('item_price', ...)` unique (item_id, tier), FK to item; `tier` ENUM (MySQL) / VARCHAR
   (SQLite).
2. `ALTER customer ADD COLUMN default_price_tier` (ENUM/VARCHAR, nullable).
3. `ALTER sales_invoice_line ADD COLUMN price_tier` (ENUM/VARCHAR, nullable).
No backfill (existing items keep pricing via `sale_price`; existing lines keep `unit_price`, `price_tier`
NULL). Dialect guards as in prior migrations; SQLite builds from models via `create_all` in tests.

**Rationale**: Smallest additive footprint; consistent with 0002–0005.
