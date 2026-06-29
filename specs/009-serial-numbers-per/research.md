# Phase 0 Research: Serial Numbers per Item

Two clarifications (dedicated receive endpoint; per-item-unique) resolved 2026-06-29.

## R1 — Registry model
`item_serial(item_id FK, serial String, status Enum[in_stock|sold], location_kind, location_id)` unique
(item_id, serial). `is_serialized` boolean on `item` (default false). The current row state answers "is
this serial sellable from here?" and "which serials are returnable?". Immutable stock movements remain
the quantity audit trail.

## R2 — Receive (`serial_service.receive`)
For a serialized item: each serial must be **new** for the item (else error). Create rows `in_stock` at
the location, then post **one stock-in movement** of `len(serials)` via the unchanged 002
`stock_service.post_movement` (movement_type "serial_receive_in"). Keeps on-hand == in-stock serial count
(FR-006). Non-serialized item → error. Uses `purchase.write`.

## R3 — Sell (`sales_service` + `serial_service.mark_sold`)
`SaleLine` gains `serials: list[str] | None`. For a **serialized** item line, validate:
- the line uses the **base unit** (factor 1) — else error;
- `len(serials) == quantity` (quantity is whole) — else error;
- every serial exists, is `in_stock`, and its location == the sale **origin** — else error.
Then the existing stock-out posts (quantity), and each serial → `sold` (location cleared). A
**non-serialized** line with serials → error; a serialized line without serials → error.

## R4 — Return (`sales_service.return_sale` + `serial_service.restore_for_return`)
`ReturnLineIn` gains `serials`. For a serialized item, the returned serials must each be `sold` and have
been on **this invoice** (verified against the invoice's sold serials — tracked by recording the sale's
serials, or by checking the serial was sold and belongs to the item; we record sale linkage on the serial
row via a nullable `sold_invoice_id` to scope returns). Restore each to `in_stock` at the invoice origin;
the existing stock-in posts; `len(serials) == returned qty`.

**Sub-decision**: add `sold_invoice_id` (nullable) to `item_serial` so a return can verify the serial was
sold on that specific invoice (set on sale, cleared on return).

## R5 — Invariant (FR-006)
Every serial state change is paired with a 002 quantity movement of the same count and direction:
receive → +N in, sale → −N out (existing), return → +N in (existing). So on-hand (derived) always equals
the in-stock serial count at a location for serialized items. Tests assert both.

## R6 — RBAC
No new capability: `is_serialized` via `catalog.write`; receive via `purchase.write` (inbound stock);
list serials via `stock.read`; sale via `sale.write`; return via `return.write` (all existing).

## R7 — Migration
`0008_serials.py` (down-revision `0007_item_units`):
1. `ALTER item ADD is_serialized BOOLEAN NOT NULL DEFAULT 0`.
2. `create_table('item_serial', ...)` unique (item_id, serial), FK item; `status` ENUM/VARCHAR;
   `sold_invoice_id` nullable FK sales_invoice.
No backfill (existing items: is_serialized false). SQLite builds from models in tests.
