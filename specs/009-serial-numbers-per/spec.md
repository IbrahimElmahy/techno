# Feature Specification: Serial Numbers per Item

**Feature Branch**: `009-serial-numbers-per`
**Created**: 2026-06-29
**Status**: Draft
**Input**: Replicate A5Group's **serial numbers** (S06): an item can be marked serialized; each physical
unit has a unique serial tracked through stock (in-stock → sold → returned). Serials enter via a dedicated
**receive** step and are captured on **sales** and **sales returns** of serialized items. Builds additively
on Sales & Inventory (002) and Multiple Units (008).

## Context & Dependencies

Builds on **002** (catalog, sales, stock) and **008** (units) and reuses — never redefines — their
primitives:

- The catalog `item` — gains an `is_serialized` flag.
- The **stock** service (002) — every serial movement still posts a quantity movement through the
  unchanged stock service; on-hand and No-Negative-Stock (Principle XI) stay authoritative and in base
  units. **The serial count at a location always equals the on-hand of that serialized item there.**
- The **sales** flow — a serialized line captures the serials sold; the existing stock-out + ledger entry
  are unchanged.

**Scope**: a serial registry (per-item unique), a dedicated **receive-serials** stock-in endpoint, and
serial capture on **sales + sales returns**. Capturing serials on purchases, production, and transfers is
**deferred** (those use the receive endpoint for now). Serialized lines transact in the **base unit**
(one serial = one base unit). The money/ledger model is unchanged.

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manager marks an item serialized and receives serials (Priority: P1)

An authorized user marks an item **serialized** and **receives** specific serial numbers into a location;
each serial is registered **in stock** and stock quantity rises by the count.

**Why this priority**: Without serialized items and a way to bring serials into stock, nothing else
applies — it is the entry point (A5Group's serial receive/print).

**Independent Test**: Mark an item serialized; receive serials `["SN-1","SN-2"]` into a warehouse;
on-hand becomes 2; the two serials are listed as in-stock; receiving a duplicate serial for the item is
rejected.

**Acceptance Scenarios**:

1. **Given** an item, **When** it is marked `is_serialized`, **Then** subsequent receive/sale operations
   require serials for it.
2. **Given** a serialized item, **When** N distinct new serials are received into a location, **Then**
   each is registered **in_stock** at that location and on-hand increases by **N**.
3. **Given** an existing serial for the item, **When** the same serial is received again, **Then** it is
   rejected (per-item unique).
4. **Given** a **non**-serialized item, **When** serials are received for it, **Then** it is rejected.

---

### User Story 2 - Seller sells specific serials (Priority: P1)

When selling a serialized item, the seller provides the exact **serials** being sold; the count must equal
the line quantity, each serial must currently be **in stock at the sale's origin**, and they become
**sold**.

**Why this priority**: This is where serials are consumed and traceability is realised (A5Group asks the
serial on the invoice line) — the headline behaviour.

**Independent Test**: Sell 2 units of a serialized item providing `["SN-1","SN-2"]` from the warehouse
that holds them; both become sold; on-hand drops by 2; selling a serial not in stock there, or a count ≠
quantity, is rejected.

**Acceptance Scenarios**:

1. **Given** a serialized line for quantity N, **When** N in-stock serials at the origin are provided,
   **Then** the sale posts, each serial becomes **sold**, and on-hand drops by N (002 stock-out unchanged).
2. **Given** a serialized line, **When** the serial count ≠ the line quantity, **Then** it is rejected.
3. **Given** a serial **not in stock at the origin** (unknown, already sold, or elsewhere), **When**
   provided on a line, **Then** it is rejected.
4. **Given** a serialized line, **When** an **alternate unit** (factor ≠ 1) is used, **Then** it is
   rejected (serialized items sell in the base unit).
5. **Given** a **non**-serialized line, **When** serials are provided, **Then** it is rejected (serials
   only for serialized items).

---

### User Story 3 - Returned serials go back into stock (Priority: P2)

A sales return of a serialized item specifies which **serials** are coming back; they return to **in
stock** at the invoice's origin and on-hand rises accordingly.

**Why this priority**: Closes the loop so a returned unit can be resold; depends on US1/US2 existing.

**Independent Test**: Return `["SN-1"]` of a serialized invoice; the serial is in-stock again, on-hand
rises by 1; returning a serial that wasn't sold on that invoice is rejected.

**Acceptance Scenarios**:

1. **Given** a serialized invoice, **When** a subset of its sold serials is returned, **Then** each is set
   **in_stock** at the origin and on-hand rises by the count (002 stock-in unchanged).
2. **Given** a return, **When** a serial that wasn't sold on that invoice is provided, **Then** it is
   rejected.
3. **Given** a return, **When** the serial count ≠ the returned quantity, **Then** it is rejected.

---

### Edge Cases

- A serial is unique **per item** (the same string may exist for a different item).
- The serial count at a location ALWAYS equals on-hand of that serialized item there (receive/sale/return
  move quantity and serial status in lockstep).
- A serialized line MUST use the base unit (one serial = one base unit; no alternate-unit factor).
- Receiving/selling/returning a serial in the wrong state (duplicate, not-in-stock, not-on-invoice) is
  rejected; non-serialized items never carry serials.
- Editing `is_serialized` after stock exists is out of scope (set it before receiving).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An item MUST have an `is_serialized` flag (managed via **catalog.write**); when set, the item
  requires serials on receive/sale/return.
- **FR-002**: The system MUST maintain a **serial registry**: each row is `item_id` + `serial` (unique per
  item) + `status` (in_stock | sold) + current `location` (kind, id) when in stock.
- **FR-003**: A dedicated **receive-serials** operation MUST register N new serials for a serialized item
  **in stock** at a location and post a stock-in movement of **N** (002 service); a duplicate serial for
  the item, or a non-serialized item, is rejected. (Uses **purchase.write**.)
- **FR-004**: Selling a serialized item MUST require a serial list whose **count equals the line
  quantity**, in the **base unit**, with **every serial in_stock at the origin**; each provided serial
  becomes **sold**; the 002 stock-out + ledger entry are unchanged. A non-serialized line MUST NOT carry
  serials.
- **FR-005**: A sales return of a serialized item MUST require the serials being returned (count = returned
  quantity); each MUST have been **sold on that invoice**; each is restored to **in_stock** at the
  invoice origin; the 002 stock-in is unchanged.
- **FR-006**: For a serialized item at any location, the **count of in_stock serials there MUST equal the
  derived on-hand** at all times (the invariant the receive/sale/return paths maintain).
- **FR-007**: All money/ledger behaviour and the 002/007/008 sale math MUST be **unchanged** — serials add
  traceability, not new money or quantity semantics.

### Key Entities *(include if feature involves data)*

- **Item (extended)**: gains `is_serialized` (bool, default false).
- **Item Serial (new)**: `item_id`, `serial` (unique per item), `status` (in_stock | sold),
  `location_kind`, `location_id` (current location while in stock). A physical unit's lifecycle.

*(Reused, not redefined: Item, SalesInvoice(+line/return), the sales/stock services, RBAC, audit.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Receiving N distinct serials raises on-hand by N and lists N in-stock serials; 100% of
  duplicate / non-serialized receives are rejected.
- **SC-002**: 100% of serialized sales require count = quantity, base unit, and in-stock-at-origin serials;
  violating lines are rejected; valid ones mark serials sold and drop on-hand by the count.
- **SC-003**: 100% of serialized returns restore only invoice-sold serials to in-stock and raise on-hand.
- **SC-004**: The in-stock serial count equals on-hand for serialized items in 100% of checks.
- **SC-005**: All 002/007/008 flows and money/ledger entries are unchanged (no regression).

## Assumptions

- Serials are **per-item unique** (chosen). The receive endpoint is the supported **stock-in** path for
  serialized items; purchases/production/transfers of serialized items are **out of scope** here.
- Serialized items transact in the **base unit** (one serial per base unit); alternate units (008) are not
  combined with serials in this feature.
- On sale, a serial becomes `sold` (its location is cleared); on return it returns to `in_stock` at the
  invoice origin. Serial history beyond current status is out of scope (the ledger/stock movements remain
  the immutable audit trail).
- Receiving serials posts a stock-in movement so on-hand and serial count stay equal; it does not create a
  purchase/supplier document.

## Out of Scope *(deferred to their own specs)*

- Serial capture on purchases, production (BOM), and transfers.
- Serial print/label/barcode (barcode is its own sub-feature); serial search reports.
- Warranty/after-sales tracking by serial; serial-level cost.
- Multi-currency; VAT.

## Clarifications

### Session 2026-06-29

- Q: How do serials enter stock? → A: **A dedicated receive-serials endpoint** now (decoupled from
  purchase/production) (FR-003).
- Q: Serial uniqueness scope? → A: **Unique per item** (FR-002).
