# Feature Specification: Barcodes per Item

**Feature Branch**: `010-barcodes-per-item`
**Created**: 2026-06-29
**Status**: Draft
**Input**: Replicate A5Group's **barcode** (S06): an item can carry one or more barcodes, each optionally
tied to a unit of measure (008), and a **scan/lookup** resolves a barcode to the item + unit for fast
sale-line entry. Scale (weighted) barcode is **deferred**. Builds additively on Sales & Inventory (002)
and Multiple Units (008).

## Context & Dependencies

Builds on **002** (catalog, sales) and **008** (units) and reuses — never redefines — their primitives:

- The catalog `item` — gains a **barcodes** collection (a new `item_barcode` table).
- The **units** (008) — a barcode may be tied to a **unit** (base or an alternate); a lookup returns that
  unit and its **factor** so a scanned "carton barcode" adds a carton line.
- The **sales** line entry — a barcode lookup returns enough to add a line (item + unit + factor);
  pricing/stock/serials behaviour is **unchanged**.

**Scope**: manage multiple barcodes per item (each optionally per-unit) + a lookup endpoint. **Scale/
weighted barcodes** (prefix-encoded weight/price) are **out of scope**. The money/ledger model is unchanged.

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manager maintains an item's barcodes (Priority: P1)

An authorized user assigns **one or more barcodes** to an item on the item card; each barcode may be tied
to a **unit** (default base). A barcode is **globally unique** (it identifies exactly one item + unit).

**Why this priority**: Without barcodes on items there is nothing to scan; it is the master data the
lookup draws on (the A5Group barcode block).

**Independent Test**: Add barcode `6221033` (base unit) and `6221040` (carton) to an item; read them back;
assigning a barcode already used by another item is rejected.

**Acceptance Scenarios**:

1. **Given** an item, **When** an authorized user adds a barcode, **Then** it is stored and listed; an
   item may have several barcodes.
2. **Given** an item with units (008), **When** a barcode is tied to a **unit**, **Then** the barcode
   records that unit (default base when omitted); the unit must be the base or a defined alternate.
3. **Given** a barcode already assigned (to any item), **When** the same barcode is assigned again, **Then**
   it is rejected (globally unique).

---

### User Story 2 - Seller scans a barcode to add a line (Priority: P1)

A barcode **lookup** resolves a scanned code to the **item + unit + factor** (and reference price) so the
sale screen can add the right line in one scan.

**Why this priority**: The lookup is the whole point of barcodes — fast, correct line entry (A5Group's POS
scan). It depends on US1.

**Independent Test**: Look up `6221040` (tied to carton, factor 12) → returns the item, unit "carton",
factor 12; an unknown barcode returns not-found.

**Acceptance Scenarios**:

1. **Given** a barcode tied to a unit, **When** it is looked up, **Then** the response is the **item** (id,
   code, name), the **unit** name, and its **factor** (and the item's base sale price for convenience).
2. **Given** a barcode tied to the **base** unit (or none), **When** looked up, **Then** the unit is the
   base and the factor is 1.
3. **Given** an **unknown** barcode, **When** looked up, **Then** the response is **not found** (404), not
   an error.
4. **Given** the lookup result, **When** the sale screen adds a line, **Then** the line uses the returned
   unit (008) and the existing pricing/stock/serial behaviour is unchanged.

---

### Edge Cases

- A barcode is **globally unique**; reusing one (same or different item) is rejected.
- A barcode tied to a unit MUST reference the item's base unit or a defined alternate (008); otherwise
  rejected.
- Deleting an item's barcode is allowed (barcodes are a lookup convenience, not posted history).
- An unknown barcode lookup returns **404**, not a server error.
- The lookup is read-only and changes no money/stock; it only returns data to pre-fill a line.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An item MUST support **multiple barcodes**; each barcode is a string that is **globally
  unique** across all items.
- **FR-002**: A barcode MAY be tied to a **unit of measure** (008) — the item's base unit (default) or a
  defined alternate; an unknown unit for the item is rejected.
- **FR-003**: Managing an item's barcodes MUST use the existing **catalog.write** capability.
- **FR-004**: A **barcode lookup** MUST resolve a code to the **item** (id, code, name), the **unit** name,
  and its **conversion factor** (and the item's base sale price); an unknown barcode returns **404**.
  Lookup uses the **catalog.read** capability.
- **FR-005**: The barcode lookup MUST be **read-only** — it changes no stock or money; it only returns data
  to pre-fill a sale line (which then follows the unchanged 002/007/008/009 behaviour).

### Key Entities *(include if feature involves data)*

- **Item Barcode (new)**: `item_id`, `barcode` (globally unique), `unit` (nullable → base). A scan target
  that maps a physical barcode to an item + unit.

*(Reused, not redefined: Item, ItemUnit (008), the sales flow, RBAC. The lookup reuses the 008 factor
resolution.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An item can hold multiple barcodes; 100% of attempts to assign an already-used barcode are
  rejected.
- **SC-002**: A barcode tied to a unit resolves to that unit + factor on lookup in 100% of cases; a
  base/none barcode resolves to factor 1.
- **SC-003**: An unknown barcode lookup returns 404 in 100% of cases (never a 500).
- **SC-004**: The lookup changes no stock/money; all 002/007/008/009 flows are unchanged (no regression).

## Assumptions

- A barcode is **globally unique** (a scan maps to exactly one item + unit). Within an item, barcodes are
  distinct by construction.
- A barcode tied to a unit reuses the **008** factor resolution; the lookup returns the factor so the
  caller adds a correctly-unitized line.
- **Scale/weighted barcodes** (prefix-encoded item + weight/price) are out of scope — this feature handles
  fixed barcodes only.
- Barcodes are mutable lookup convenience (add/remove freely); they are not posted-document history.

## Out of Scope *(deferred to their own specs)*

- Scale/weighted barcode parsing (prefix config + embedded weight/price).
- Barcode label printing; min/max & expiry; inventory valuation.
- Multi-currency; VAT.

## Clarifications

### Session 2026-06-29

- Q: Does a barcode tie to a specific unit? → A: **Yes — a barcode per unit** (multiple barcodes per item,
  each optionally per-unit) (FR-002).
- Q: Scale (weighted) barcode now or later? → A: **Later** — normal fixed barcode now (Out of Scope).
