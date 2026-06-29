# Implementation Plan: Barcodes per Item

**Branch**: `010-barcodes-per-item` | **Date**: 2026-06-29 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-barcodes-per-item/spec.md`
**Builds on**: Sales & Inventory (`002`) + Multiple Units (`008`). Fourth sub-feature of the A5Group
Item-card track (S06 — after pricing, units, serials).

## Summary

Add **barcodes** to items: a new `item_barcode(item_id, barcode, unit)` table holds multiple
globally-unique barcodes per item, each optionally tied to a unit (008). A `barcode_service` validates and
resolves codes. Managing barcodes uses **catalog.write** (`GET/PUT /items/{id}/barcodes`); a read-only
**lookup** `GET /barcodes/{code}` (catalog.read) resolves a scanned code to the item (id/code/name), the
unit, and its **factor** (via the 008 resolver) plus the base sale price — enough for the sale screen to
add a correctly-unitized line in one scan. Unknown codes return 404. The lookup changes no stock/money;
all 002/007/008/009 behaviour is unchanged. Built test-first (Principle X) for global uniqueness,
per-unit validation, and the lookup (factor + 404).

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001–009
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+; quantity `QTY` DECIMAL(18,3)
**Testing**: pytest, httpx ASGI client; SQLite in-memory; MySQL for migration check
**Target Platform**: Linux server; Electron+React back-office client
**Project Type**: Web service — additive modules under `backend/`
**Performance Goals**: barcode lookup is a single unique-key read
**Constraints**: barcode globally unique; lookup read-only; reuse 008 factor + existing capabilities; no
new role; no 002–009 behaviour change
**Scale/Scope**: a few barcodes per item; one new table + one lookup endpoint

## Constitution Check

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New barcodes from spec; A5Group feature, no legacy code/data. ✅ |
| II | Single Source of Truth | OpenAPI extended additively; drift-gated. ✅ |
| III | Offline-First Mobile | Lookup is additive/read-only; sale path unchanged. ✅ |
| IV | Reversibility | No posted state; barcodes are mutable lookup data. ✅ |
| V | Multi-Branch & Warehouse | Orthogonal. ✅ |
| VI | Treasury & Customer Accounts | Lookup read-only; money/ledger untouched. ✅ |
| VII | RBAC | Reuses catalog.read/write; no new role. ✅ |
| VIII | Arabic RTL / EGP | Unaffected; barcodes are data. ✅ |
| IX | Reporting first-class | Barcode aids entry; no shadow data. ✅ |
| X | Test-First | Uniqueness, per-unit, lookup get failing tests first. ✅ |
| XI | No Negative Stock | N/A — lookup posts no stock. ✅ |

**Gate result: PASS.** Decisions in Complexity Tracking (justified).

## Project Structure

```text
backend/src/
├── models/
│   └── catalog.py        # NEW ItemBarcode(item_id, barcode unique, unit nullable)
├── services/
│   └── barcode_service.py     # NEW: set_barcodes() (validate unique + unit), lookup() → item+unit+factor
├── api/
│   └── catalog.py        # EXTEND: GET/PUT /items/{id}/barcodes; GET /barcodes/{code} lookup
├── migrations/versions/
│   └── 0009_barcodes.py       # additive: item_barcode table (unique barcode)
└── tests/
    ├── unit/   (test_barcode_rules — unique + per-unit + lookup-factor)
    ├── integration/ (test_barcodes_api — manage + lookup + 404 + RBAC)
    └── contract/ (test_barcodes_contract)
```

**Structure Decision**: Additive only — one new `item_barcode` table, a new `barcode_service`, and two
catalog-router additions (manage + lookup). Migration `0009_barcodes` chains on `0008_serials`. The lookup
reuses the 008 `uom_service.resolve_factor`. No 002–009 behaviour changes.

## Complexity Tracking

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Barcodes in a **separate `item_barcode` table** (not a column) | An item carries several barcodes (per unit/packaging) and each must be globally unique and looked up by code | A single column caps one barcode per item and can't index a global-unique scan key cleanly |
| **Globally-unique** barcode | A scan must map to exactly one item + unit; a physical barcode belongs to one product | Per-item uniqueness lets two items share a code, making the scan ambiguous |
| Barcode **tied to a unit** (008) reusing the factor resolver | A "carton barcode" must add a carton line; reusing 008 keeps one source of truth for factors | A barcode-specific factor duplicates 008 and drifts when a unit's factor changes |
| **Read-only lookup** endpoint (no line creation) | Keeps the feature additive and the sale path unchanged; the client adds the line via the existing sale API | A "scan-and-post" endpoint would fork sale logic and bypass the 002/007/008/009 guards |
