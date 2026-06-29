---
description: "Task list for Five Sale Price Tiers — additive to 002"
---

# Tasks: Five Sale Price Tiers

**Input**: Design documents from `/specs/007-five-sale-price/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml
**Builds on**: Sales & Inventory (`002`) — reuse the catalog, customer, sales/ledger/stock services,
RBAC, audit. **No ledger change.** The base `item.sale_price` stays as the fallback.

**Tests**: REQUIRED. Principle X — test-first for the three critical paths: **tier resolution**
(explicit→default→consumer→base fallback + snapshot), **below-price control** (rejected w/o cap; allowed
w/ cap; at/above always ok), and **002-unchanged** (discount/split/ledger). Each gets a failing [test]
before its [impl].

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` red-green · `[US#]` user story · each cites its
FR(s). **Path base**: `backend/` (additive — one new table, two nullable columns, one enum, one
capability, a new pricing service, small sales/router extensions; 002 money path untouched).

---

## Phase 1: Setup — Enum, Model, RBAC

- [X] T001 [impl] Extend `src/models/catalog.py`: add `PriceTier` enum (commercial, semi_commercial, wholesale, semi_wholesale, consumer); add `ItemPrice` (item_id FK indexed, tier Enum, price MONEY, UNIQUE(item_id,tier)) — data-model §item_price; research R1/R2
- [X] T002 [impl] `src/models/__init__.py`: register `ItemPrice`
- [X] T003 [impl] Extend `src/models/customer.py` `Customer`: add `default_price_tier` (Enum(PriceTier), nullable) — FR-004; research R5
- [X] T004 [impl] Extend `src/models/sales.py` `SalesInvoiceLine`: add `price_tier` (Enum(PriceTier), nullable) snapshot — FR-007; research R6
- [X] T005 [impl] Extend `src/auth/rbac.py`: `CAP_SELL_BELOW_PRICE = "sell.below_price"` → system_admin, branch_manager, sales_manager (NOT sales_rep) — FR-009; research R7
- [X] T006 [impl] Extend `tests/conftest.py`: a product-with-tier-prices factory + a customer-with-default-tier helper, reusing `inv_world` — reused by all phases

**Checkpoint**: enum, item_price table, customer/line columns, and the new capability exist.

---

## Phase 2: Pricing Service — [US1][US2] 🎯

**Goal**: Deterministic tier resolution with the base-price fallback.
**Independent Test**: explicit tier → that price; no tier + customer default → default price; no default →
consumer; missing tier row → base sale_price; none → error.

### Tests first (Principle X)

- [X] T007 [P] [test] [US1][US2] `tests/unit/test_tier_resolution.py`: `resolve_tier` (explicit→default→consumer); `tier_price` (item_price row → fallback `sale_price` → error when neither); values match — FR-003/005; SC-002

### Implementation (make T007 green)

- [X] T008 [impl] `src/services/pricing_service.py`: `resolve_tier(line_tier, customer)` and `tier_price(db, item, tier)` (item_price lookup, fallback to `item.sale_price`, else `PricingError`) — FR-003/005; research R3

**Checkpoint**: T007 green; pricing resolution is a verified pure function.

---

## Phase 3: Item Tier Prices + Customer Default Tier — [US1][US2]

**Goal**: Manage the five prices on the item and the default tier on the customer.
**Independent Test**: set five tiers, read back; set a customer default; both gated by their capability.

- [X] T009 [impl] [US1] `src/api/catalog.py`: `GET /items/{id}/prices` and `PUT /items/{id}/prices` (set/replace tiers; products only; price ≥ 0; `catalog.write`) returning base + tiers — contracts; FR-001
- [X] T010 [P] [test] [US1] `tests/integration/test_item_prices_api.py`: set/read five tiers; non-product rejected (422); negative rejected; non-catalog role denied (403) — US1 scenarios; FR-001
- [X] T011 [impl] [US2] Extend `src/api/customers.py`: `default_price_tier` in customer create/update/out (`customer.write`) — FR-004
- [X] T012 [P] [test] [US2] `tests/integration/test_customer_default_tier.py`: set/read default tier; persists; gated by `customer.write` — US2 scenarios; FR-004

**Checkpoint**: items carry five prices; customers carry a default tier.

---

## Phase 4: Tier-Aware Sale + Below-Price Control — [US3] 🎯

**Goal**: Resolve the line price from the tier (override per line); gate below-tier selling.
**Independent Test**: default pre-fill; per-line override; below-tier rejected w/o cap, allowed w/ cap;
at/above always ok; the line records tier + actual price; discount/split/ledger unchanged from 002.

### Tests first (Principle X)

- [X] T013 [P] [test] [US3] `tests/unit/test_sell_below_price.py`: actual < tier_price rejected when `can_sell_below=False`; allowed when True; actual ≥ tier_price always allowed; the recorded `unit_price` is the actual and `price_tier` the resolved — FR-006/007; SC-003
- [X] T014 [P] [test] [US3] `tests/integration/test_sale_with_tiers.py`: a line with no tier prices at the customer default; an explicit-tier line prices from that tier; a Rep selling below is rejected (422), a Manager allowed; gross/net/cash-credit/ledger entry identical to a 002 sale at the same prices — US3 scenarios; SC-004

### Implementation (make T013–T014 green)

- [X] T015 [impl] [US3] Extend `src/services/sales_service.py`: `SaleLine` gains `tier`/`unit_price`; `create_sale(..., can_sell_below)` resolves tier + price via `pricing_service`, enforces below-price, records `price_tier` + actual `unit_price`; all other math unchanged — FR-005/006/007/008; research R4
- [X] T016 [impl] [US3] Extend `src/api/sales.py`: `SaleLineIn` gains `tier`/`unit_price`; compute `can_sell_below` from `role_has_capability(current.role, CAP_SELL_BELOW_PRICE)` and pass it; invoice-line output gains `price_tier` — contracts; FR-006/009

**Checkpoint**: T013–T014 green; sales price by tier with the below-price boundary; 002 behaviour intact.

---

## Phase 5: Migration, Contract & Polish

- [X] T017 [impl] Alembic `0006_price_tiers` (down_revision `0005_cost_centers`): create `item_price` (unique item+tier, FK item); `ALTER customer ADD default_price_tier`; `ALTER sales_invoice_line ADD price_tier`; ENUM on MySQL / VARCHAR on SQLite; additive, no backfill — research R8
- [X] T018 [P] [test] `tests/integration/test_migration_additive_007.py`: down_revision `0005_cost_centers`; `item_price` in metadata; `customer` has `default_price_tier`; `sales_invoice_line` has `price_tier`; PriceTier has 5 values
- [X] T019 [impl] Extend `scripts/check_contract_drift.py` to include the 007 contract; the 001–006 gate stays green — Principle II
- [X] T020 [P] [test] `tests/contract/test_price_tiers_contract.py`: `/items/{id}/prices` GET/PUT present; sale line schema exposes `tier`/`unit_price`; invoice-line out exposes `price_tier`; customer schema exposes `default_price_tier`
- [X] T021 [P] [impl] Index review (`item_price` unique (item,tier)) + run quickstart smoke end-to-end

---

## Phase 6: Frontend (Desktop, Arabic RTL)

- [X] T022 [impl] `frontend/src/pages/Catalog.tsx`: an item **«الأسعار»** action/drawer to view/set the five tier prices (تجاري/نصف تجاري/جملة/نصف جملة/مستهلك)
- [X] T023 [impl] `frontend/src/pages/Customers.tsx`: a **«الفئة السعرية الافتراضية»** select on the customer form
- [X] T024 [impl] `frontend/src/pages/Invoices.tsx`: sale line gains a **tier** select (pre-filled from the customer default) + an editable unit price; surface the below-price 422 message
- [X] T025 [P] [impl] `tsc --noEmit` clean; tier labels Arabic; load tiers from `/api/v1/items/{id}/prices`

---

## Dependencies & Execution Order

### Phase order (hard sequence)
Setup (P1) → **Pricing service (P2)** → Item/Customer prices (P3) → **Tier-aware sale (P4)** →
Migration/Contract (P5) → Frontend (P6).

Rationale: the sale resolution needs the pricing service (P2) and the data it reads (P3); the contract/
frontend consume all endpoints (P5/P6 last).

### Test-before-impl pairings (Principle X)
- T007 (resolution) **before** T008.
- T013 (below-price) **before** T015–T016.
- T010/T012/T014 are integration checks paired with their phase impl.

### Key blocking edges
- T001 → everything (enum + table). T003/T004 → resolution + sale snapshot.
- T008 (pricing_service) → T015 (sale uses it). T005 (capability) → T016 (router computes can_sell_below).
- T009/T011 (data endpoints) → frontend P6.

### Parallel opportunities
- Critical-path tests T007/T013 parallel; integration T010/T012/T014/T018/T020 parallel.
- Frontend tabs T022/T023/T024 independent files (parallel once endpoints exist).

---

## Implementation Strategy

### MVP backbone first
1. P1–P2: enum/table + the verified pricing function.
2. P3–P4: data endpoints + tier-aware sale with the below-price guard.
3. **STOP and VALIDATE**: resolution + below-price + 002-unchanged green before frontend.

### Incremental delivery
- +Item/customer endpoints (P3) → priceable masters. +Sale (P4) → tiered invoices. +Migration (P5) →
  ship on MySQL. +Frontend (P6) → visible.

### Notes
- Additive only: new table + two nullable columns + one enum + one capability; base `sale_price` kept.
- Tiers only set the line price; discount/split/ledger/stock are exactly 002.
- `sell.below_price` is deny-by-default; Sales Reps cannot undercut tiers.
