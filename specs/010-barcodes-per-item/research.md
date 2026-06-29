# Phase 0 Research: Barcodes per Item

Two clarifications (barcode per unit; scale barcode deferred) resolved 2026-06-29.

## R1 — Model
`item_barcode(item_id FK, barcode String unique, unit String NULL)`. `barcode` is **globally unique**
(DB unique index). `unit` is the unit the barcode represents — NULL = base; an alternate must be a
defined `item_unit` name for the item (validated against 008).

## R2 — Manage (`barcode_service.set_barcodes`)
`PUT /items/{id}/barcodes` replaces the item's barcode set. Validate: within the set names distinct;
each barcode not already used by another item (global unique); each `unit` (if set) is the base or an
existing `item_unit` of the item — else error.

## R3 — Lookup (`barcode_service.lookup`)
`GET /barcodes/{code}` → find the `item_barcode` by code (global unique). Resolve the unit's **factor** via
the 008 `uom_service.resolve_factor(item, unit)`. Return `{item_id, code, name, unit, factor, base_sale_price}`.
Unknown code → `None` → the router returns **404**. Read-only (no stock/money).

## R4 — RBAC
Manage via **catalog.write**; lookup via **catalog.read**. No new capability/role.

## R5 — Migration
`0009_barcodes.py` (down-revision `0008_serials`): `create_table('item_barcode', ...)` with a unique index
on `barcode`, FK to item. No backfill. SQLite builds from models in tests.
