# Implementation Plan: Serial Numbers per Item

**Branch**: `009-serial-numbers-per` | **Date**: 2026-06-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-serial-numbers-per/spec.md`
**Builds on**: Sales & Inventory (`002`) + Multiple Units (`008`). Third sub-feature of the A5Group
Item-card track (S06 — after pricing and units).

## Summary

Add **serial numbers** as a per-item-unique registry tracked through stock. `item.is_serialized` marks an
item; `item_serial(item_id, serial, status, location)` records each physical unit (`in_stock` ↔ `sold`).
A dedicated **receive-serials** operation registers N new serials in stock at a location and posts a
stock-in of N through the unchanged 002 stock service. Selling a serialized item requires a serial list
whose **count equals the line quantity**, in the **base unit**, every serial **in_stock at the origin**;
each becomes `sold` and the existing 002 stock-out + ledger entry are unchanged. A sales return restores
the named serials (must have been sold on that invoice) to `in_stock`. The invariant: the **in-stock
serial count at a location equals the on-hand** of that serialized item there. A new `serial_service`
owns the registry transitions. Built test-first (Principle X) for receive uniqueness, sell-from-stock,
the count/base-unit guards, and the return restore.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001–008
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+; quantity `QTY` DECIMAL(18,3)
**Testing**: pytest, httpx ASGI client; SQLite in-memory; MySQL for migration check
**Target Platform**: Linux server; Electron+React back-office client
**Project Type**: Web service — additive modules under `backend/`
**Performance Goals**: serial lookups keyed by (item, serial); sale adds one check per serial
**Constraints**: serial count == on-hand for serialized items; base unit only; money/ledger unchanged;
reuse existing capabilities; no new role
**Scale/Scope**: serialized items a subset of catalog; serial rows scale with units handled

## Constitution Check

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New serials from spec; A5Group feature, no legacy code/data. ✅ |
| II | Single Source of Truth | OpenAPI extended additively; drift-gated. ✅ |
| III | Offline-First Mobile | Sale path shared; serial fields additive. ✅ |
| IV | Reversibility | Returns restore serials; stock movements immutable & reverse-once (002). ✅ |
| V | Multi-Branch & Warehouse | Serials carry a location; orthogonal otherwise. ✅ |
| VI | Treasury & Customer Accounts | Money/ledger untouched; serials are traceability only. ✅ |
| VII | RBAC | Reuses catalog.write / purchase.write / sale.write / return.write; no new role. ✅ |
| VIII | Arabic RTL / EGP | Unaffected; serials are data. ✅ |
| IX | Reporting first-class | Serial registry enables traceability/reporting. ✅ |
| X | Test-First | Receive/sell/return + guards get failing tests first. ✅ |
| XI | No Negative Stock | Every serial move posts a 002 quantity movement; on-hand authoritative. ✅ |

**Gate result: PASS.** Decisions in Complexity Tracking (justified).

## Project Structure

```text
backend/src/
├── models/
│   ├── catalog.py        # EXTEND Item: +is_serialized; NEW ItemSerial(item_id, serial, status, location)
│   └── sales.py          # (no change — serials live in item_serial, linked by sale at runtime)
├── services/
│   ├── serial_service.py      # NEW: receive(), mark_sold(), restore_for_return()
│   └── sales_service.py       # EXTEND SaleLine (+serials); validate count/base/in-stock; mark sold; return restore
├── api/
│   ├── catalog.py        # EXTEND: is_serialized on item create/update/out; receive + list serials endpoints
│   └── sales.py          # EXTEND SaleLineIn (+serials); ReturnLineIn (+serials)
├── migrations/versions/
│   └── 0008_serials.py        # additive: item.is_serialized; item_serial table
└── tests/
    ├── unit/   (test_serial_receive, test_serial_sale_guards, test_serial_return)
    ├── integration/ (test_serials_api, test_serial_sale_flow)
    └── contract/ (test_serials_contract)
```

**Structure Decision**: Additive only — `item.is_serialized` column, a new `item_serial` table, a new
`serial_service`, and small extensions to `sales_service` + the catalog/sales routers. Migration
`0008_serials` chains on `0007_item_units`. The stock service is untouched (serial paths call it with
quantity = serial count). Non-serialized items and all 002/007/008 behaviour are unchanged.

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| A **serial registry table** with status + location (not a per-movement serial log) | The current state (in_stock-where / sold) must be queryable to validate a sale and find returnable serials; the immutable stock movements remain the quantity audit trail | A movement-only serial log requires replaying every movement to know a serial's current state for each sale check |
| **Receive-serials posts a stock-in movement** (qty = count) | Keeps on-hand == serial count (FR-006) without a second quantity store; reuses No-Negative-Stock | A pure registry without a movement diverges on-hand from serial count and breaks the negative-stock guard |
| Serialized lines **base unit only** (one serial = one base unit) | Avoids ambiguous "2 cartons → how many serials?"; keeps count == quantity unambiguous | Combining factors with serials needs a serial-per-base expansion that this sub-feature defers |
| Reuse **existing capabilities** (catalog/purchase/sale/return.write) | Serials are catalog/stock/sale concerns already governed; no distinct authority boundary | A new serial.* capability multiplies grants for no new boundary |

> Note: purchases/production/transfers of serialized items are deferred — the receive endpoint is the
> supported stock-in path; this keeps the feature additive and the stock service untouched.
