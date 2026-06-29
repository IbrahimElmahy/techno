# Implementation Plan: Five Sale Price Tiers

**Branch**: `007-five-sale-price` | **Date**: 2026-06-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-five-sale-price/spec.md`
**Builds on**: Sales & Inventory (`002`) — implemented and tested. First sub-feature of the A5Group
Item-card track (S06 — pricing), per the approved Review build order (item: price tiers → units → …).

## Summary

Give each item **five named sale prices** (commercial, semi-commercial, wholesale, semi-wholesale,
consumer) and apply them on the sales invoice. A new `item_price(item_id, tier, price)` table holds the
tiers (the base `item.sale_price` stays as the fallback); the `customer` gains a `default_price_tier`;
each `sales_invoice_line` records the **resolved tier** plus the **actual unit price** charged. The sale
service resolves a line's price from its tier (explicit → customer default → consumer → base), and a new
**`sell.below_price`** capability gates charging below the resolved tier price (managers yes, reps no).
Everything downstream — discount %, cash/credit split, the single balanced ledger entry, stock-out,
returns — is **unchanged** (tiers only decide the line price). Built test-first (Principle X) for tier
resolution, the snapshot, and the below-price control.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001–006
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)` via shared `MONEY`
**Testing**: pytest, httpx ASGI client; SQLite in-memory for unit/integration, MySQL for migration check
**Target Platform**: Linux server (same app, same schema); Electron+React back-office client
**Project Type**: Web service — additive modules under the existing `backend/`
**Performance Goals**: tier resolution is a single keyed lookup per line; sale latency unchanged
**Constraints**: money/ledger model unchanged; price snapshot on the line; below-price gated by capability;
base sale_price retained as fallback (no 002 regression)
**Scale/Scope**: 5 tiers/item; thousands of items/customers; no new ledger, one new capability

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New pricing from spec; A5Group feature, no legacy code/data. ✅ |
| II | Single Source of Truth (API contract) | OpenAPI extended additively under `contracts/`; drift-gated. ✅ |
| III | Offline-First Mobile | Sale path shared with mobile; tier fields are additive & optional; rep cannot sell below tier. ✅ |
| IV | Reversibility | No ledger change; returns reverse exactly as 002. ✅ |
| V | Multi-Branch & Multi-Warehouse | Pricing orthogonal to location; unchanged. ✅ |
| VI | Treasury & Customer Accounts | Money/ledger model untouched; tiers only set the line price. ✅ |
| VII | RBAC | New `sell.below_price` capability (deny-by-default); reps excluded. ✅ |
| VIII | Arabic RTL / EGP | EGP money reused; tier names are labels. ✅ |
| IX | Reporting first-class | Line records tier + actual price → priceable analysis later. ✅ |
| X | Test-First (NON-NEGOTIABLE) | Tier resolution, snapshot, below-price control get failing tests first. ✅ |
| XI | No Negative Stock | Stock-out path unchanged (still guarded). ✅ |

**Gate result: PASS.** Deliberate decisions recorded in Complexity Tracking (justified).

## Project Structure

### Documentation (this feature)

```text
specs/007-five-sale-price/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/openapi.yaml      # item tier-price endpoints + customer default tier + sale line tier/price
├── checklists/requirements.md  # spec quality (done)
└── tasks.md                    # /speckit.tasks output (NOT created here)
```

### Source Code (additive to the existing backend/)

```text
backend/src/
├── models/
│   ├── catalog.py        # EXTEND: PriceTier enum; NEW ItemPrice(item_id, tier, price)
│   ├── customer.py       # EXTEND Customer: +default_price_tier (nullable enum)
│   └── sales.py          # EXTEND SalesInvoiceLine: +price_tier (snapshot)
├── auth/
│   └── rbac.py           # NEW capability sell.below_price → system_admin, branch_manager, sales_manager
├── services/
│   ├── pricing_service.py     # NEW: resolve_tier(), tier_price(item, tier) with fallback to sale_price
│   └── sales_service.py       # EXTEND SaleLine (+tier, +unit_price override); resolve price + below-price check
├── api/
│   ├── catalog.py        # EXTEND: GET/PUT /items/{id}/prices (the five tiers)
│   ├── customers.py      # EXTEND: default_price_tier in customer create/update/out
│   └── sales.py          # EXTEND SaleLineIn (+tier, +unit_price); pass actor capability through
├── migrations/versions/
│   └── 0006_price_tiers.py  # additive: item_price table; customer.default_price_tier; sales_invoice_line.price_tier
└── tests/
    ├── unit/
    │   ├── test_tier_resolution.py     # explicit→default→consumer→base fallback; snapshot value
    │   └── test_sell_below_price.py    # below rejected w/o cap; allowed w/ cap; at/above always ok
    ├── integration/
    │   ├── test_item_prices_api.py     # set/read five tiers; catalog.write gate
    │   ├── test_customer_default_tier.py# set/read default tier; customer.write gate
    │   └── test_sale_with_tiers.py     # default pre-fill; per-line override; line records tier+price; 002 unchanged
    └── contract/
        └── test_price_tiers_contract.py # new endpoints/fields in OpenAPI + drift gate
```

**Structure Decision**: One app, one schema, one Alembic history. Additive only: a new `item_price`
table, two nullable columns (`customer.default_price_tier`, `sales_invoice_line.price_tier`), a new
`pricing_service`, a new capability, and small extensions to `sales_service` + three routers. Migration
`0006_price_tiers` chains on `0005_cost_centers`. The base `item.sale_price` is kept as the fallback so
002 data and tests stay valid; the money/ledger path is untouched.

## Complexity Tracking

> Deliberate structure beyond the simplest approach — justified, not constitution violations.

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Tiers in a **separate `item_price` table** (not five columns on `item`) | A5Group's tier set may grow/relabel; a keyed (item, tier) row keeps the item lean and lets a missing tier fall back cleanly | Five fixed columns bloat the item, make "is this tier set?" ambiguous (0 vs unset), and resist later tier changes |
| Keep the base **`item.sale_price` as fallback** rather than migrating it into a tier | 002 data and tests rely on `sale_price`; a missing tier must still price a line | Backfilling every item into five tiers is a data migration with no source data and would break 002's single-price tests |
| New **`sell.below_price` capability** (not a per-user flag) | Clarified; below-price authority is a real boundary (managers vs reps) and fits the deny-by-default capability model | A per-user numeric "min price" flag is the A5Group 350-flag sprawl we explicitly chose roles over |
| Record **both tier and actual price** on the line | FR-007 — reporting needs the intended tier and the realised price (which may be overridden) | Storing only the price loses the tier (can't analyse tier mix); storing only the tier loses below-price overrides |

> Note: the below-price check compares the **actual unit price** to the **resolved tier price for that
> item**; equality is allowed. Selling **above** the tier is never restricted (upsell), matching A5Group.
