# Feature Specification: Multiple Units of Measure

**Feature Branch**: `008-multiple-units-measure`
**Created**: 2026-06-29
**Status**: Draft
**Input**: Replicate A5Group's **multiple units per item + conversion factor (معادل)** (S06): an item has a
base unit plus alternate units (e.g. piece → carton = 12), sales/purchases may transact in any unit, and
**stock is always tracked in the base unit** (quantity × factor). The unit price defaults to the
base-unit price × factor (overridable). Builds additively on Sales & Inventory (002) and Price Tiers (007).

## Context & Dependencies

Builds on **002** (catalog, sales, purchases, stock) and **007** (price tiers) and reuses — never
redefines — their primitives:

- The catalog `item` — `unit_of_measure` becomes the **base unit**; alternate units are added in a new
  `item_unit` table (name + factor to base).
- The **sales** and **purchase** invoice flows — each line may pick a **unit**; the entered quantity is in
  that unit; the line records the unit + its factor; **stock posts the base quantity** (qty × factor).
- The **stock** service (002) — unchanged: it stores/derives on-hand in the base unit; No-Negative-Stock
  (Principle XI) holds in base units.
- The **pricing** (007) — tier prices are per **base** unit; a line's default price = base-tier price ×
  factor; the below-price capability check compares against that.

**Scope**: units on sales + purchases + stock conversion. Serials, barcode, limits/expiry, and inventory
valuation (the rest of S06) are **deferred**. The money/ledger model is unchanged.

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manager defines an item's units (Priority: P1)

An authorized user defines, on the item card, **alternate units** with a **conversion factor** to the base
unit (e.g. base = piece; carton = 12; dozen = 12; box = 24). The base unit has factor 1.

**Why this priority**: Nothing can transact in a unit before it exists; it is the master data the feature
draws on (the A5Group معادل block).

**Independent Test**: Add a "carton = 12" unit to a piece-based item; read it back; a duplicate unit name
or a non-positive factor is rejected.

**Acceptance Scenarios**:

1. **Given** a product/raw item, **When** an authorized user adds an alternate unit with a positive factor,
   **Then** it is stored and listed alongside the base unit (factor 1).
2. **Given** an item's units, **When** a unit name duplicates an existing one (incl. the base), **Then** it
   is rejected; a factor ≤ 0 is rejected.
3. **Given** an alternate unit used on a posted document, **When** deletion is attempted, **Then** it is
   rejected (the document's snapshot is preserved).

---

### User Story 2 - Seller/buyer transacts in a chosen unit (Priority: P1)

On a sales or purchase line the user may pick a **unit**; the quantity is entered in that unit; the line
records the unit + factor; **stock moves in the base unit** (qty × factor). The unit price defaults to the
base-unit price × factor.

**Why this priority**: This is where units are applied; without it the master data is inert (A5Group asks
the unit on the document line).

**Independent Test**: Sell 2 cartons (factor 12) of a piece-based item; stock-out is 24 pieces; the line
price defaults to the base price × 12; an explicit unit transacts, a missing unit uses the base.

**Acceptance Scenarios**:

1. **Given** an item with a "carton = 12" unit, **When** a sale line sells 2 cartons, **Then** stock
   decreases by **24 base units** and the line stores unit="carton", factor=12, quantity=2.
2. **Given** a sale line with **no** unit, **When** posted, **Then** it transacts in the **base** unit
   (factor 1) — identical to 002 behaviour.
3. **Given** a line priced by tier (007), **When** a unit with factor F is chosen, **Then** the default
   unit price = base-tier price × F (still overridable; the below-price capability check uses base × F).
4. **Given** a purchase line in a chosen unit, **When** posted, **Then** stock **increases** by qty × F
   base units and the line records the unit + factor.
5. **Given** a return of N units of a line, **When** posted, **Then** stock reverses by N × the line's
   factor base units and the money reverses by N × the line's unit price.

---

### User Story 3 - On-hand and No-Negative stay in base units (Priority: P1)

On-hand stock and the No-Negative-Stock guard operate in the **base unit**, regardless of the unit a
document used.

**Why this priority**: Correctness — mixing units in stock would corrupt balances; the base unit is the
single quantity truth.

**Independent Test**: After selling 2 cartons (24 base) from 30 base on-hand, on-hand is 6 base; an
attempt to sell more base than available (in any unit) is rejected.

**Acceptance Scenarios**:

1. **Given** mixed-unit movements, **When** on-hand is read, **Then** it is the signed sum in **base
   units** (Σ in − out, all converted).
2. **Given** insufficient base stock, **When** a sale in any unit would drive on-hand negative, **Then**
   it is rejected (Principle XI), the message in base units.

---

### Edge Cases

- A unit name MUST be unique per item (including the base unit name); a factor MUST be > 0.
- A line with no unit uses the base unit (factor 1) — 002/007 behaviour is unchanged.
- Stock is ALWAYS base units; the document line keeps the entered (unit) quantity + the factor snapshot.
- A return's quantity is in the **same unit as its invoice line**; stock/money reverse using the line's
  factor and unit price.
- Editing an item's units never changes a posted line's factor (snapshot).
- The base-unit price × factor is the default; an explicit unit price overrides it (below-base×factor still
  needs the 007 `sell.below_price` capability).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An item MUST support **alternate units of measure**, each with a **name** and a **conversion
  factor (> 0)** to the base unit (`item.unit_of_measure`, factor 1). Unit names are unique per item.
- **FR-002**: A unit that appears on a posted document line MUST NOT be hard-deleted (snapshot preserved).
- **FR-003**: A **sales** or **purchase** line MAY specify a **unit**; the entered **quantity is in that
  unit**; the line MUST record the **unit name** and its **factor** (snapshot). No unit ⇒ base unit (1).
- **FR-004**: **Stock movements MUST be posted in the base unit** = entered quantity × factor; on-hand and
  No-Negative-Stock (Principle XI) operate in base units (002 unchanged).
- **FR-005**: A sale line's **default unit price** MUST be the resolved **base-unit tier price (007) ×
  factor**; an explicit unit price overrides it; the **below-price** capability check (007) compares the
  actual price to base-tier price × factor.
- **FR-006**: A **return** MUST reverse stock by `returned_qty × line.factor` base units and money by
  `returned_qty × line.unit_price`, using the original line's snapshot.
- **FR-007**: All money/ledger behaviour (discount, cash/credit split, the one balanced entry) MUST be
  **unchanged** from 002/007 — units only convert quantity and scale the per-unit price.
- **FR-008**: Managing item units uses the existing **catalog.write** capability; no new role or capability.

### Key Entities *(include if feature involves data)*

- **Item Unit (new)**: A per-item alternate unit — `item_id`, `name`, `factor` (decimal > 0), unique on
  (item_id, name). The base unit is `item.unit_of_measure` with implicit factor 1.
- **Sales / Purchase Invoice Line (extended)**: each gains `unit` (name, nullable → base) and
  `unit_factor` (snapshot, default 1). `quantity` stays the entered quantity in that unit; `unit_price` is
  per the chosen unit.

*(Reused, not redefined: Item, SalesInvoice(+line), PurchaseInvoice(+line), the sales/purchase/stock/
pricing services, RBAC, audit.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An item can carry multiple units; 100% of duplicate-name or non-positive-factor attempts are
  rejected.
- **SC-002**: A document line in a unit with factor F moves exactly **qty × F base units** of stock in
  100% of cases; a line with no unit moves qty base units (002 unchanged).
- **SC-003**: On-hand and No-Negative-Stock are computed in base units in 100% of checks (no unit mixing).
- **SC-004**: A tiered line's default price equals base-tier price × F; the 007 below-price control still
  holds against base × F in 100% of cases.
- **SC-005**: All 002/007 flows and money/ledger entries are unchanged (no regression).

## Assumptions

- Stock is tracked in the **base unit** only; there is no per-unit stock balance (units are a presentation/
  entry convenience converted at the document boundary).
- Conversion factors are **fixed per item** (no time-phased factors); a factor is a positive decimal so
  fractional units (e.g. 0.5 kg) are expressible.
- Tier prices (007) remain per **base** unit; a unit's price is derived (× factor) not stored per unit
  (the chosen "base × factor" decision).
- One line per item per document (the existing 002 return-aggregation assumption is retained).

## Out of Scope *(deferred to their own specs)*

- Per-unit explicit price tables; barcode-per-unit (scale barcode); serial numbers; min/max & expiry.
- Inventory valuation / average cost; time-phased conversion factors.
- Multi-currency; VAT.

## Clarifications

### Session 2026-06-29

- Q: How is a larger unit's price computed? → A: **Base-unit price × factor (auto, overridable)** — tiers
  stay per base unit (FR-005).
- Q: Where do units apply now? → A: **Sales + purchases + stock**; stock is always the base unit
  (FR-003/004).
