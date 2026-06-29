# Phase 1 Data Model: Serial Numbers per Item

Additive to 002/008. **One flag** on item + **one new table**. Serial moves are paired with 002 quantity
movements so on-hand == in-stock serial count.

## Extended: `item` (002)
| Column | Type | Notes |
|---|---|---|
| **is_serialized** | Boolean default false | when true, item requires serials on receive/sale/return |

## New entity: `item_serial`
| Column | Type | Notes |
|---|---|---|
| id | BigIntPK | |
| item_id | BigInteger FK→item.id, indexed | |
| serial | String(64) | the serial string |
| status | Enum(SerialStatus) | `in_stock` \| `sold` |
| location_kind | Enum(LocationKind) NULL | current location while in_stock (NULL when sold) |
| location_id | BigInteger NULL | current location id while in_stock |
| sold_invoice_id | BigInteger FK→sales_invoice.id NULL | set on sale, cleared on return (scopes returns) |
| — | UNIQUE(item_id, serial) | per-item unique |

### Enum: `SerialStatus` = `in_stock | sold`

## Service surface (`serial_service`)
- `receive(db, item, location_kind, location_id, serials, actor)` → create in_stock rows (reject dup/non-
  serialized) + `stock_service.post_movement(in, qty=len)`.
- `mark_sold(db, item, origin_kind, origin_id, serials, invoice_id)` → validate each in_stock@origin;
  set status=sold, location cleared, sold_invoice_id.
- `restore_for_return(db, item, invoice_id, origin_kind, origin_id, serials)` → validate each sold on this
  invoice; set in_stock@origin, clear sold_invoice_id.
- `assert_sale_serials(db, item, qty, unit_factor, serials)` → count==qty, base unit (factor 1),
  serialized↔serials consistency.

## Sales integration
- `SaleLine` gains `serials: list[str] | None`. For serialized items: `assert_sale_serials` then
  `mark_sold` (after the stock-out); for non-serialized: serials must be empty.
- `ReturnLine` gains `serials`. For serialized items: `restore_for_return` (after the stock-in);
  count == returned qty.

## Invariant (FR-006)
```text
receive N  →  +N stock-in   + N serials in_stock@loc
sell    N  →  −N stock-out  + N serials → sold        (count == line qty, base unit)
return  N  →  +N stock-in   + N serials → in_stock    (must be sold on this invoice)
⇒ in_stock serial count @loc == on_hand(item, loc)   for serialized items
```

## Validation summary (test-first)
| Rule | Where | Test |
|---|---|---|
| receive: new-per-item; serialized only; +N stock; in_stock@loc | serial_service.receive | test_serial_receive |
| sell: count==qty, base unit, in_stock@origin; → sold | sales_service + serial_service | test_serial_sale_guards |
| non-serialized+serials / serialized w/o serials rejected | sales_service | test_serial_sale_guards |
| return: sold-on-this-invoice; → in_stock; count==qty | serial_service.restore_for_return | test_serial_return |
| on-hand == in-stock serial count | end-to-end | test_serial_sale_flow |

## ER (additive)
```text
item (1) ──< item_serial (item_id, serial)   # per-item unique; status + location
item_serial ── sold_invoice_id → sales_invoice  # set on sale, cleared on return
```
