# Implementation Plan: Sales & Inventory

**Branch**: `002-sales-inventory` | **Date**: 2026-06-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-sales-inventory/spec.md`
**Builds on**: Foundation (`001-foundation`) — implemented and live on MySQL/MariaDB.

## Summary

Add the operational inventory + trade layer on top of Foundation: a shared two-kind catalog
(raw materials, products) with decimal quantities and per-item units; an **append-only stock-movement
model** where on-hand per (item × location) is **derived** (never stored), enforcing No-Negative-Stock
(Principle XI) at write time; suppliers & purchases (with supplier credit), decoupled manufacturing
(consume/produce), sales invoices (combined-% discount, split cash/credit), Branch-Manager-approved
transfers, and partial reversible returns.

All money continues to post to the **Foundation double-entry ledger** — we **extend** it (add new
`account_type` values), never fork it; all balances stay ledger-derived. RBAC, branches, territories,
warehouses, custodies, customers, and the audit log are **reused, not redefined**. Built test-first
(Principle X) for the critical paths.

## Technical Context

**Language/Version**: Python 3.12 (running 3.11 in dev) — same as Foundation
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, bcrypt, python-jose — reused
**Storage**: MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)`, quantity `DECIMAL(18,3)`
**Testing**: pytest, httpx ASGI client; SQLite in-memory for unit/integration, MySQL for migration check
**Target Platform**: Linux server (same service as Foundation; one app, one schema)
**Project Type**: Web service — additive modules under the existing `backend/`
**Performance Goals**: on-hand derivation p95 < 300 ms at feature scale; write-path lock contention
bounded per (item × location)
**Constraints**: ledger-derived balances only; stock quantity-only (no valuation/COGS); append-only
movements + ledger; No-Negative-Stock enforced at write; one balanced ledger entry per money event
**Scale/Scope**: low-thousands of items, tens of locations, unbounded append-only movement history

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New modules authored from spec; legacy data migrated later. ✅ |
| II | Single Source of Truth (API contract) | OpenAPI extended additively under `contracts/`; FastAPI-generated, drift-gated. ✅ |
| III | Offline-First Mobile | Out of scope here (server-side only); no offline schema. Rep flow modeled server-side for spec 4 to mirror. ✅ |
| IV | Reversibility | Every movement and money entry is append-only with a linked mirror reversal; returns are partial linked records. ✅ |
| V | Multi-Branch & Multi-Warehouse | Sales decrement only the originating location; transfers are explicit; shared catalog, per-location stock. ✅ |
| VI | Treasury & Customer Accounts | Extends the **one** ledger with new `account_type`s; all balances (incl. new supplier payable) ledger-derived. ✅ |
| VII | RBAC | Reuses Foundation deny-by-default + branch/rep scope; new capabilities added to the existing map. ✅ |
| VIII | Arabic RTL / EGP | EGP money type reused; presentation is client-side; error codes locale-neutral. ✅ |
| IX | Reporting first-class | On-hand and balances are derived from movements/ledger — reports read the same source of truth. ✅ |
| X | Test-First (NON-NEGOTIABLE) | No-negative-stock, on-hand derivation, reversal symmetry, discount math, split cash/credit balancing get failing tests first. ✅ |
| XI | No Negative Stock | Enforced at write time against committed on-hand under a per-(item×location) lock. ✅ |

**Gate result: PASS.** Three deliberate structural decisions are recorded in Complexity Tracking
(justified, not violations).

## Project Structure

### Documentation (this feature)

```text
specs/002-sales-inventory/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/openapi.yaml      # extended surface (this feature's endpoints)
└── tasks.md                    # /speckit.tasks output (not created here)
```

### Source Code (additive to the existing backend/)

```text
backend/src/
├── models/
│   ├── catalog.py        # Item (raw_material | product), unit, prices
│   ├── supplier.py       # Supplier, SupplierAccount
│   ├── stock.py          # StockMovement (immutable), StockLocator (lock anchor)
│   ├── purchasing.py     # PurchaseInvoice/Line, PurchaseReturn/Line
│   ├── sales.py          # SalesInvoice/Line, SalesReturn/Line, SalesSetting
│   ├── manufacturing.py  # ManufacturingOp (consume | produce)
│   ├── transfer.py       # StockTransfer
│   └── ledger.py         # EXTEND AccountType (+supplier_payable, +sales_revenue, +purchases_expense)
├── services/
│   ├── stock_service.py        # post_movement(), on_hand(), reverse_movement() — no-negative guard
│   ├── purchase_service.py     # purchase + partial return → stock + ledger
│   ├── sales_service.py        # discount math, split cash/credit → stock + ledger
│   ├── manufacturing_service.py# consume / produce (independent)
│   └── transfer_service.py     # initiate / approve / reverse
├── api/
│   ├── catalog.py  suppliers.py  purchases.py  sales.py
│   ├── manufacturing.py  transfers.py  stock.py  settings.py
├── migrations/versions/
│   └── 0002_sales_inventory.py # additive: ALTER account enum, new tables, stock immutability trigger
└── tests/
    ├── unit/
    │   ├── test_stock_no_negative.py      # Principle XI
    │   ├── test_on_hand_derivation.py     # on-hand = Σ movements
    │   ├── test_movement_reversal.py      # mirror symmetry
    │   ├── test_discount_math.py          # combined % once on gross
    │   └── test_sale_ledger_balance.py    # split cash/credit balances
    ├── integration/ (purchase, manufacturing, sale, transfer, returns journeys)
    └── contract/   (extended OpenAPI shape + drift)
```

**Structure Decision**: One app, one schema, one Alembic history. Sales & Inventory is additive: new
models/services/routers, a single additive migration with down-revision `0001_baseline`, and the
`AccountType` enum extended in place. Nothing in Foundation is redefined.

## Complexity Tracking

> Deliberate structure beyond the simplest approach — justified, not constitution violations.

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Add `sales_revenue` and `purchases_expense` account types (beyond the cash/AR/AP enumerated in clarification Q4) | Double-entry MUST balance (Foundation enforces Σdebit=Σcredit). A sale needs a revenue credit; a purchase needs an expense debit. These are P&L accounts — they do **not** reintroduce inventory-asset valuation or COGS (still deferred): purchases expensed at purchase, sales recognized at sale, inventory uncapitalized. | Posting only cash/AR/AP cannot form a balanced entry; a single equity "clearing" account would obscure revenue vs cost and break future reporting |
| Separate **append-only stock-movement ledger** (parallel to the money ledger), not stored on-hand | Stock is quantity-only and multi-dimensional (item × location × unit); it cannot live as money `ledger_line`s. Mirroring the ledger philosophy keeps on-hand derived and reversible (Principle IV/XI). | A stored `quantity_on_hand` column drifts and violates derive-from-truth (cf. SC-002); putting stock in the money ledger conflates units with currency |
| `stock_locator` row per (item × location) used as a `SELECT … FOR UPDATE` **lock anchor** at write time | No-Negative-Stock must hold under concurrency without a stored balance; locking the locator serializes writers for that (item, location) so the on-hand recompute + insert is atomic. | Locking all movement rows is a wider hotspot; optimistic checks race two concurrent sales below zero; a stored balance would drift (rejected above) |
