# Feature Specification: Stock Min/Max Limits & Expiry Batches

**Feature Branch**: `011-stock-min-max`
**Created**: 2026-06-30
**Status**: Draft
**Input**: Replicate A5Group's item **min/max limits** and **expiry date** (S06): per-item minimum and
maximum stock thresholds with a **reorder report**, and **expiry-date batch tracking** for perishable
items with **FEFO** (first-expiry-first-out) consumption on sale and an **expiring-soon report**. Builds
additively on Sales & Inventory (002).

## Context & Dependencies

Builds on **002** (catalog, sales, stock) and reuses — never redefines — its primitives:

- The catalog `item` — gains `min_stock`, `max_stock` (advisory thresholds) and an `is_perishable` flag.
- The **stock** service (002) — every batch movement still posts a quantity movement through the unchanged
  stock service; on-hand and No-Negative-Stock (Principle XI) stay authoritative. **The sum of a
  perishable item's batch quantities at a location equals its on-hand there.**
- The **sales** flow — a perishable line consumes batches FEFO; the existing stock-out + ledger entry are
  unchanged.

**Scope**: min/max thresholds + reorder report; expiry batches + FEFO sale + batch receive + expiring
report + perishable returns. Perishable items transact in the **base unit** (one batch quantity is in base
units). The money/ledger model is unchanged.

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manager sets min/max and sees a reorder report (Priority: P1)

An authorized user sets an item's **minimum** and **maximum** stock levels (advisory, base units). A
**reorder report** lists items whose total on-hand is **below minimum** (reorder) or **above maximum**
(overstock).

**Why this priority**: Min/max drive purchasing decisions; the reorder report is the payoff (A5Group's
limits report). It's independent of expiry.

**Independent Test**: Set min=10, max=100 on an item with on-hand 5 → it appears in the report as "below
min"; with on-hand 120 → "above max"; within range → not listed. Setting a limit never blocks a sale.

**Acceptance Scenarios**:

1. **Given** an item, **When** min/max are set, **Then** they are stored (base units, advisory) and
   returned on the item card.
2. **Given** items with limits, **When** the reorder report is requested, **Then** each item with total
   on-hand < min is flagged **below_min**, each with on-hand > max is flagged **above_max**, others are
   excluded.
3. **Given** a limit, **When** a sale would take on-hand below min, **Then** the sale is **not blocked**
   (limits are advisory; only No-Negative-Stock blocks).

---

### User Story 2 - Receive perishable stock with an expiry date (Priority: P1)

An authorized user marks an item **perishable** and **receives batches** with an **expiry date**; each
batch registers its quantity at a location and stock rises by that quantity.

**Why this priority**: Batches with expiry are the master data FEFO and the expiring report draw on (the
A5Group expiry block).

**Independent Test**: Mark perishable; receive 10 units expiring 2026-12-31 and 5 units expiring
2026-06-30 into a warehouse → on-hand 15; two batches listed; receiving for a non-perishable item is
rejected.

**Acceptance Scenarios**:

1. **Given** an item, **When** it is marked `is_perishable`, **Then** receive/sale/return require batch
   handling for it.
2. **Given** a perishable item, **When** a batch of N with an expiry date is received into a location,
   **Then** a batch row is created and on-hand rises by **N** (002 stock-in unchanged).
3. **Given** a **non**-perishable item, **When** a batch is received for it, **Then** it is rejected.

---

### User Story 3 - Sell perishable stock FEFO (Priority: P1)

Selling a perishable item consumes quantity from batches **earliest-expiry-first**; on-hand and the batch
quantities drop together. The sale is in the **base unit**.

**Why this priority**: FEFO is the core rotation behaviour that prevents selling newer stock before older
(A5Group's expiry consumption) — the headline behaviour.

**Independent Test**: With batches 5@2026-06-30 and 10@2026-12-31, sell 7 → the 5-unit batch is emptied
and 2 taken from the later batch; on-hand 8; the earliest batch is gone.

**Acceptance Scenarios**:

1. **Given** batches with different expiries, **When** N units of a perishable item are sold, **Then** the
   consumed quantity is drawn **earliest-expiry-first**; batches deplete accordingly and on-hand drops by
   N (002 stock-out unchanged).
2. **Given** a perishable line, **When** it uses an **alternate unit** (008, factor ≠ 1), **Then** it is
   rejected (perishable items sell in the base unit).
3. **Given** insufficient batch quantity at the origin, **When** a sale is attempted, **Then** it is
   rejected (No-Negative-Stock; batch sum = on-hand).

---

### User Story 4 - Return perishable stock & see what's expiring (Priority: P2)

A sales return of a perishable item restores quantity to a batch (with the returned expiry). An
**expiring-soon report** lists batches expiring on/before a chosen date.

**Why this priority**: Closes the loop and surfaces near-expiry stock; depends on US2/US3.

**Independent Test**: Return 2 units with expiry 2026-12-31 → a batch of 2 at that expiry exists and
on-hand rises by 2; the expiring report before 2026-07-01 lists only earlier-expiry batches.

**Acceptance Scenarios**:

1. **Given** a perishable sale, **When** N units are returned with an expiry date, **Then** a batch of N
   at that expiry is created/increased at the origin and on-hand rises by N (002 stock-in unchanged).
2. **Given** batches, **When** the expiring report is requested for a cutoff date, **Then** it lists
   batches with expiry ≤ cutoff and remaining quantity > 0, earliest first.
3. **Given** a perishable return, **When** no expiry date is provided, **Then** it is rejected (a batch
   needs an expiry).

---

### Edge Cases

- Min/max are **advisory** — never block a sale; only No-Negative-Stock blocks.
- The sum of a perishable item's batch quantities at a location ALWAYS equals its on-hand there.
- Perishable items transact in the **base unit** (one batch quantity is base units).
- A batch quantity never goes negative; FEFO stops at available and No-Negative-Stock rejects a shortfall.
- Receiving/selling/returning batches for a non-perishable item, or a perishable return without an expiry,
  is rejected.
- min/max/is_perishable are optional; existing 002 items are unaffected (limits null, not perishable).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An item MUST support optional **min_stock** and **max_stock** (base-unit quantities,
  advisory) managed via **catalog.write**; setting them never blocks any operation.
- **FR-002**: A **reorder report** MUST list items with total on-hand **< min_stock** (below_min) or
  **> max_stock** (above_max), excluding items within range or without limits.
- **FR-003**: An item MUST support an **is_perishable** flag (catalog.write); when set, the item is
  batch-tracked by expiry.
- **FR-004**: A **batch receive** operation MUST register a batch (item, location, expiry_date, quantity)
  for a perishable item and post a stock-in of that quantity (002 service); a non-perishable item is
  rejected. (Uses **purchase.write**.)
- **FR-005**: Selling a perishable item MUST consume batch quantity **first-expiry-first (FEFO)** at the
  origin, in the **base unit**; batches deplete accordingly and the 002 stock-out + ledger entry are
  unchanged; insufficient batch quantity is rejected (No-Negative-Stock).
- **FR-006**: A sales return of a perishable item MUST restore the returned quantity to a batch at the
  provided **expiry_date** (create or increase) at the invoice origin; the 002 stock-in is unchanged; a
  missing expiry_date is rejected.
- **FR-007**: For a perishable item at any location, the **sum of batch quantities MUST equal the derived
  on-hand** at all times (the invariant receive/sale/return maintain).
- **FR-008**: An **expiring-soon report** MUST list batches with `expiry_date ≤ cutoff` and remaining
  quantity > 0, earliest expiry first (uses **stock.read**).
- **FR-009**: All money/ledger behaviour and the 002/007/008/009 flows MUST be **unchanged** — limits and
  batches add planning + rotation, not new money or quantity semantics.

### Key Entities *(include if feature involves data)*

- **Item (extended)**: gains `min_stock` (QTY nullable), `max_stock` (QTY nullable), `is_perishable`
  (bool default false).
- **Stock Batch (new)**: `item_id`, `location_kind`, `location_id`, `expiry_date`, `quantity` (remaining,
  base units). A lot of stock with a shared expiry at a location.

*(Reused, not redefined: Item, SalesInvoice(+line/return), the sales/stock services, RBAC, audit.)*

## Success Criteria *(mandatory)*

- **SC-001**: Items below min / above max appear correctly in the reorder report in 100% of checks;
  limits never block a sale.
- **SC-002**: Receiving a batch raises on-hand by its quantity and lists the batch; 100% of non-perishable
  receives are rejected.
- **SC-003**: 100% of perishable sales consume batches earliest-expiry-first and drop on-hand by the sold
  quantity; alternate-unit perishable lines are rejected.
- **SC-004**: The batch-quantity sum equals on-hand for perishable items in 100% of checks.
- **SC-005**: The expiring report returns exactly the batches at/before the cutoff with remaining > 0.
- **SC-006**: All 002/007/008/009 flows and money/ledger entries are unchanged (no regression).

## Assumptions

- Min/max are **item-level, total-on-hand** thresholds (across locations) and **advisory** (planning only).
- Perishable items are batch-tracked; the **batch receive** endpoint is the supported stock-in path;
  purchases/production of perishable items use it. Perishable items transact in the **base unit**.
- FEFO consumes by earliest `expiry_date`, then by batch id; a batch never goes negative.
- Perishable returns restore to a batch at a **caller-provided** expiry (the original batch is not
  tracked per-line); this keeps the batch-sum = on-hand invariant.
- An item is perishable **or** serialized (009) in practice; combining both is out of scope.

## Out of Scope *(deferred to their own specs)*

- Per-store min/max; auto purchase-order generation from the reorder report.
- Serial + batch on the same item; batch on purchases/production documents (use batch receive).
- Inventory valuation / batch cost; time-phased limits.
- Multi-currency; VAT.

## Clarifications

### Session 2026-06-30

- Q: Scope — limits only, or include expiry batches? → A: **Both** — min/max + reorder report **and**
  expiry-date batch tracking with FEFO + expiring report (this spec).
