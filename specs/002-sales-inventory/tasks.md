---
description: "Task list for Sales & Inventory implementation (additive to Foundation)"
---

# Tasks: Sales & Inventory

**Input**: Design documents from `/specs/002-sales-inventory/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi.yaml
**Builds on**: Foundation (`001`) — reuse ledger, RBAC, customers, warehouses, custodies, audit.

**Tests**: REQUIRED. Principle X mandates test-first for **no-negative-stock**, **on-hand derivation**,
**movement reversal symmetry**, **discount math**, and **split cash/credit ledger balancing**. Each
such area's failing unit test ([test]) is written and committed **before** its implementation ([impl]).

**Labels**: `[P]` parallelizable · `[test]`/`[impl]` red-green · `[US#]` user story · each task cites
its FR(s)/scenario(s). **Path base**: `backend/` (additive — do not modify Foundation behavior).

---

## Phase 1: Setup & Ledger Extension

- [X] T001 [impl] Extend `src/models/ledger.py` `AccountType` enum with `supplier_payable`, `sales_revenue`, `purchases_expense` (normal sides per data-model §0) — research R1; Principle VI
- [X] T002 [impl] `src/services/account_resolver.py`: get-or-create singleton `sales_revenue` + `purchases_expense` accounts; resolve an actor's **cash-location** account (rep→custody, branch→treasury/custody); get-or-create a supplier's `supplier_payable` account — research R1/R6
- [X] T003 [P] [impl] Extend `src/auth/rbac.py` capability map: `catalog.read/write`, `supplier.read/write`, `purchase.write`, `manufacture.write`, `sale.write`, `transfer.initiate`, `transfer.approve`, `stock.read`, `return.write`, `settings.write`, mapped per clarified roles — FR-026–028; research R12
- [X] T004 [P] [impl] `src/core/money.py`: add `QTY = Numeric(18,3)` + `to_qty()` decimal helper (no float) — FR-002a
- [X] T005 [impl] Extend `tests/conftest.py` with fixtures: a central warehouse, a branch warehouse, per-rep custodies (with ledger accounts), and item/supplier factory helpers — reused by all phases

**Checkpoint**: ledger account model extended; capabilities and fixtures ready.

---

## Phase 2: Catalog — Items (raw_material + product) — [US1][US2]

**Goal**: One shared catalog, two kinds, decimal qty + unit, editable code, kind-specific prices.
**Independent Test**: Create a raw material (kg, purchase price) and a product (piece, sale price);
confirm a product is rejected on a purchase line and a raw material on a sale line.

- [X] T006 [impl] [US2] `src/models/catalog.py`: `Item` (code UNIQUE editable, name, kind, unit_of_measure, purchase_price?, sale_price?, active) — FR-001–005, FR-002a; data-model §1
- [X] T007 [impl] [US2] Register `Item` in `src/models/__init__.py`; add to migration set (Phase 8)
- [X] T008 [impl] [US2] `src/api/catalog.py`: list/create/patch items (capability `catalog.*`); system-generated editable code; kind/price validation — FR-002/003/004
- [X] T009 [P] [test] [US2] `tests/integration/test_catalog.py`: raw material not sellable, product not purchasable, editable code, decimal unit — FR-003/004; US2 scenarios 1–3

**Checkpoint**: catalog usable by stock and documents.

---

## Phase 3: Stock Core (append-only movements; on-hand derived) 🎯 the heart

**Goal**: Immutable stock movements; on-hand = Σ movements; No-Negative-Stock at write; reversible.
**Independent Test**: Post in/out movements, derive on-hand, reverse one; an out beyond on-hand is
rejected; movements cannot be mutated.

### Tests first (Principle X)

- [X] T010 [P] [test] `tests/unit/test_on_hand_derivation.py`: on-hand == Σ(in−out) per (item×location) after a mixed sequence incl. a reversal; **no stored on-hand column**; **also assert `StockMovement` has no monetary/value column and no inventory-asset/COGS `AccountType` exists** (Q4 boundary) — FR-007, FR-008a; SC-002
- [X] T011 [P] [test] `tests/unit/test_stock_no_negative.py`: an `out` exceeding on-hand rejected; equal allowed; two concurrent outs cannot both pass (locator lock) — FR-008; Principle XI; SC-001
- [X] T012 [P] [test] `tests/unit/test_movement_reversal.py`: every movement type has a mirror reversal (in↔out) linked via `reverses_movement_id`; reverse-once; UPDATE/DELETE on a posted movement rejected — FR-007/025; Principle IV

### Implementation (make T010–T012 green)

- [X] T013 [impl] `src/models/stock.py`: `StockMovement` (immutable; item, location_kind/id, movement_type, direction, quantity>0, source_doc, `reverses_movement_id` UNIQUE, actor; **no value column**) + ORM immutability guard — data-model §3; FR-007/008a
- [X] T014 [impl] `src/models/stock.py`: `StockLocator` (UNIQUE item×location) lock anchor — research R3
- [X] T015 [impl] `src/services/stock_service.py` `post_movement()`: lock locator `FOR UPDATE`, compute on-hand, reject if out drives <0, insert movement — FR-008; Principle XI
- [X] T016 [impl] `src/services/stock_service.py` `on_hand(item, location)`: Σ(in−out) — FR-007; depends on T013
- [X] T017 [impl] `src/services/stock_service.py` `reverse_movement()`: mirror linked movement, reverse-once — FR-025; depends on T015
- [X] T018 [impl] `src/api/stock.py`: `GET /stock/on-hand` (capability `stock.read`, scope-filtered) — FR-007

**Checkpoint**: T010–T012 green. Stock is a verified, derived, reversible source of truth.

---

## Phase 4: Suppliers & Purchases (+ partial returns) — [US1][US6]

**Goal**: Suppliers with payable accounts; purchases bring raw materials in + balanced cash/credit
entry; partial reversible purchase returns (proportional money reversal).
**Independent Test**: Purchase 100 (400 cash/600 credit) → raw on-hand +100, supplier payable +600;
partial return of 30 → stock −30 and proportional money reversal.

- [X] T019 [P] [impl] [US1] `src/models/supplier.py`: `Supplier`, `SupplierAccount` (→ `supplier_payable` account) — data-model §2; FR-009
- [X] T020 [impl] [US1] `src/models/purchasing.py`: `PurchaseInvoice`/`Line`, `PurchaseReturn`/`Line` — data-model §4; FR-010–012
- [X] T021 [impl] [US1] `src/api/suppliers.py`: list/create supplier (creates payable account), `GET /suppliers/{id}/account` (derived balance) — FR-009; depends on T002, T019
- [X] T022 [impl] [US1] `src/services/purchase_service.py` `create_purchase()`: per-line `purchase_in` movements (T015) + one balanced entry (debit purchases_expense; credit cash-location + supplier_payable) — FR-010–012; research R5
- [X] T023 [impl] [US6] `src/services/purchase_service.py` `return_purchase()`: caller supplies quantities only; cumulative ≤ purchased; `purchase_return_out` movements + **proportional** reversing entry computed from the original cash/credit split — FR-012/025; research R9
- [X] T024 [impl] [US1] `src/api/purchases.py`: `POST /purchases`, `POST /purchases/{id}/returns` (capability `purchase.write`/`return.write`, branch-scoped) — FR-009–012
- [X] T025 [P] [test] [US1] `tests/integration/test_purchase.py`: split cash/credit purchase → on-hand + payable balance (US1 scenario 5); raw-only enforcement; **assert editing the item's reference price does NOT change the posted purchase line's price** (snapshot immutability) — FR-011; Edge Case
- [X] T026 [P] [test] [US6] `tests/integration/test_purchase_return.py`: partial return; money reversal proportional to the original cash/credit split; over-return rejected; reversible — FR-012; research R9

**Checkpoint**: inbound chain works; payables ledger-derived.

---

## Phase 5: Manufacturing (decoupled) — [US3]

**Goal**: Two independent stock operations; no linkage, no BOM, no money; each explicitly reversible.
**Independent Test**: Consume 30 raw at Central (on-hand −30); separately produce 10 product (on-hand
+10); reverse a consumption and a production via the reverse endpoint; no enforced link.

- [X] T027 [impl] [US3] `src/models/manufacturing.py`: `ManufacturingOp` (op_type consume|produce, item, location, quantity, stock_movement_id) — data-model §6; FR-013
- [X] T028 [impl] [US3] `src/services/manufacturing_service.py`: `consume()` (raw out, no-negative) and `produce()` (product in) — independent; each one movement; FR-014/015
- [X] T029 [impl] [US3] `src/services/manufacturing_service.py` `reverse_op()`: reverse a consume or produce via `stock_service.reverse_movement` (linked mirror, reverse-once, no money; reversed produce subject to no-negative) — FR-016; SC-003; research R7
- [X] T030 [impl] [US3] `src/api/manufacturing.py`: `POST /manufacturing/consume`, `POST /manufacturing/produce`, `POST /manufacturing/{id}/reverse` (capability `manufacture.write`) — FR-013–016
- [X] T031 [P] [test] [US3] `tests/integration/test_manufacturing.py`: consume decrements (rejected below zero), produce increments at chosen location, no linkage, and **reversing a consumption returns stock / reversing a production removes it** (each reverse-once) — US3 scenarios 1–4; FR-016; SC-003

**Checkpoint**: raw → product conversion via two independent, reversible ops.

---

## Phase 6: Sales (discount + split cash/credit) + sales returns — [US4][US6]

**Goal**: Sell products from origin; combined-% discount once on gross; split cash/credit to one
balanced entry; partial reversible returns with **proportional** money reversal.
**Independent Test**: Rep sells 3 of a product (gross 300, 5%+10% → net 255, 100 cash/155 credit):
custody on-hand −3, rep custody +100, customer receivable +155, sales_revenue 255.

### Tests first (Principle X)

- [X] T032 [P] [test] [US4] `tests/unit/test_discount_math.py`: `combined = fixed+variable` applied once to gross; net rounding 2dp; variable-only and zero cases; no amount path — FR-019; SC-006
- [X] T033 [P] [test] [US4] `tests/unit/test_sale_ledger_balance.py`: split sale posts ONE balanced entry (Σdebit=Σcredit); rep sale debits **rep custody**, branch sale debits branch treasury/custody; credit→customer receivable; credit→sales_revenue net — FR-020; research R6

### Implementation (make T032–T033 green)

- [X] T034 [impl] [US4] `src/models/sales.py`: `SalesInvoice`/`Line` (snapshots: gross, fixed/variable/combined %, net, cash/credit, cash_account_id), `SalesReturn`/`Line` (derived cash_refund/credit_reduction — not caller-set), `SalesSetting` — data-model §5
- [X] T035 [impl] [US4] `src/services/sales_service.py` `create_sale()`: discount math, resolve actor cash location (T002), per-line `sale_out` at origin (T015, Principle V), one balanced entry — FR-017–020
- [X] T036 [impl] [US6] `src/services/sales_service.py` `return_sale()`: caller supplies quantities only; cumulative ≤ sold; `sale_return_in` movements + **proportional** reversing entry computed from the original invoice's cash/credit split — FR-021/025; research R9
- [X] T037 [impl] [US4] `src/api/sales.py`: `POST /sales`, `GET /sales/{id}` (printable payload), `POST /sales/{id}/returns` (capabilities `sale.write`/`return.write`; rep→own custody/customers) — FR-017–021, FR-026/028
- [X] T038 [P] [test] [US4] `tests/integration/test_sale.py`: rep end-to-end (own customer/custody origin), stock decremented, no-negative rejection, cross-rep/branch denials; **assert editing the product sale price does NOT change the posted invoice line's price** (snapshot immutability) — US4 scenarios 1–4; FR-011; SC-004/005
- [X] T039 [P] [test] [US6] `tests/integration/test_sale_return.py`: partial return cumulative ≤ sold; **money reversal proportional to the original invoice's cash/credit split** (caller provides only quantities); over-return rejected; reversible — US6 scenarios 2/4; research R9

**Checkpoint**: core revenue flow + returns, ledger-balanced.

---

## Phase 7: Stock Transfers (approval) — [US5]

**Goal**: Pending→approved transfers on allowed routes; **source-branch** Branch-Manager approval;
atomic out+in; reversible; no-negative at source.
**Independent Test**: Initiate central→rep 20 (no stock moves); the source-branch Branch Manager
approves → source −20, dest +20; a non-source-branch manager is denied; reverse moves it back; illegal
route rejected.

- [X] T040 [impl] [US5] `src/models/transfer.py`: `StockTransfer` (route, source/dest, status, initiated_by, approved_by, out/in movement ids) — data-model §7
- [X] T041 [impl] [US5] `src/services/transfer_service.py`: `initiate()` (validate route, no stock yet), `approve()` (approver MUST manage the **source location's branch**; central source ⇒ head-office/central authority; atomic out+in under locks), `reverse()` (mirror pair) — FR-022–024; research R8
- [X] T042 [impl] [US5] `src/api/transfers.py`: `POST /transfers`, `POST /transfers/{id}/approve`, `POST /transfers/{id}/reverse` (capabilities `transfer.initiate`/`transfer.approve`) — FR-022/023/027
- [X] T043 [P] [test] [US5] `tests/integration/test_transfer.py`: pending has no movement; **only the source-branch Branch Manager approves (a non-source-branch manager is denied 403)**; atomic out+in; no-negative at source; reverse; illegal route 422 — US5 scenarios 1–5; FR-023

**Checkpoint**: stock distribution with source-branch approval + reversal.

---

## Phase 8: Settings, Migration, RBAC matrix & Polish

- [X] T044 [impl] `src/api/settings.py`: `GET/PUT /settings/sales` (fixed discount %; capability `settings.write`); snapshot-on-invoice ensures posted invoices unaffected — FR-029
- [X] T045 [impl] Alembic `0002_sales_inventory` (down_revision `0001_baseline`): MySQL `MODIFY` account enum (+3 values), create all new tables, install `stock_movement` immutability triggers — research R11; additive only
- [X] T046 [impl] Register all new models in `src/models/__init__.py`; verify `Base.metadata` create_all (SQLite tests) + migration (MySQL) agree
- [X] T047 [P] [test] `tests/integration/test_migration_additive.py` (or migration check): upgrade→downgrade→upgrade clean on MySQL; new enum values + stock triggers present; live UPDATE/DELETE on a stock movement rejected
- [X] T048 [impl] Update `specs/002-sales-inventory/contracts/openapi.yaml` parity; extend the contract-drift check to include this feature's paths (Foundation gate stays green) — Principle II
- [X] T049 [P] [test] `tests/contract/test_sales_inventory_contract.py`: new endpoints present in `/openapi.json` (incl. `/manufacturing/{id}/reverse`); error envelopes (403/409/422) for no-negative-stock and scope denials
- [X] T050 [P] [test] `tests/integration/test_rbac_matrix.py`: role→capability matrix — Purchasing Manager cannot create a sales invoice; Sales Manager cannot manufacture; Sales Rep cannot approve transfers; only Purchasing Manager records purchases — FR-028
- [X] T051 [P] [impl] Index review (`stock_movement(item_id, location_kind, location_id)`, document_number uniques) + run quickstart smoke end-to-end — plan Performance

---

## Dependencies & Execution Order

### Phase order (hard sequence)
Setup (P1) → Catalog (P2) → **Stock Core (P3)** → Purchases (P4) → Manufacturing (P5) → Sales (P6)
→ Transfers (P7) → Settings/Migration/Polish (P8).

Rationale: stock movements reference items (P2 before P3); every domain posts movements via
`stock_service` (P3 before P4–P7); money posting reuses Foundation ledger + the new account types
(P1 before P4/P6).

### Test-before-impl pairings (Principle X)
- T010–T012 (on-hand / no-negative / reversal) **before** T013–T018.
- T032–T033 (discount math / split balance) **before** T034–T037.

### Key blocking edges
- T001 + T002 → T022 (purchase posting), T035 (sale posting).
- T006 (Item) → T013 (StockMovement FK).
- T013 → T015 → {T022, T028, T035, T041}; T015 → T017 → T029 (manufacturing reverse).
- T003 (capabilities) → all routers (T008, T021, T024, T030, T037, T042, T044).

### Parallel opportunities
- Setup: T003, T004 parallel; T005 after models exist.
- Stock tests T010, T011, T012 parallel; sales tests T032, T033 parallel.
- Domain integration tests (T025/T026, T031, T038/T039, T043, T047, T049, T050) mutually parallel.

---

## Implementation Strategy

### MVP backbone first
1. Phases 1–3: extended ledger + catalog + the verified stock core (no-negative, derived, reversible).
2. Phase 4 + Phase 6: inbound (purchases) and the core revenue flow (sales) — the business minimum.
3. **STOP and VALIDATE**: stock-core green + sale ledger-balance green before transfers/returns breadth.

### Incremental delivery
- +Purchases → stock in + payables → demo. +Manufacturing → raw→product → demo. +Sales → revenue +
  receivable/custody → demo (MVP). +Transfers → distribution → demo. +Returns/Settings/Migration → ship.

### Notes
- All money via Foundation `ledger_service.post_entry` as ONE balanced entry; balances derived.
- Returns: caller supplies quantities only; money reversal is **proportional** to the original
  document's cash/credit split (sales and purchases symmetric).
- Stock is quantity-only — movements carry no money; manufacturing/transfers post no ledger entry.
- No-negative-stock checked under the `stock_locator` `FOR UPDATE` lock; `Decimal` for money/qty.
- Additive only: do not modify Foundation tables/behavior beyond the `account` enum extension.
