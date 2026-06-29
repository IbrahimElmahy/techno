# Feature Specification: Five Sale Price Tiers

**Feature Branch**: `007-five-sale-price`
**Created**: 2026-06-29
**Status**: Draft
**Input**: Replicate A5Group's **5 price tiers** per item (تجارى / نصف تجارى / جملة / نصف جملة / مستهلك)
and apply them on the sales invoice — each customer has a **default tier** that pre-fills the line, the
seller may switch the tier per line, and **selling below** the chosen tier's price requires a
**capability**. First sub-feature of the A5Group Item-card enhancement track (S06 — pricing).

## Context & Dependencies

This builds on **Sales & Inventory (002)** and reuses — never redefines — its primitives:

- The **catalog** `item` (one fixed `sale_price` today) — extended with **five named tier prices**.
- The **sales invoice** flow (`sales_service.create_sale`) — the line `unit_price`, today read straight
  from `item.sale_price`, instead resolves from the **chosen tier** (with manual override).
- The **customer** card — gains a **default price tier**.
- **RBAC** (deny-by-default) — a new `sell.below_price` capability gates below-tier selling.

**Scope is price tiers only.** Multiple units, serials, barcode, limits/expiry, and inventory valuation
(the rest of S06) are **deferred to their own sub-features**. No change to the money/ledger model — tiers
only decide the line price; everything downstream (discount, cash/credit split, the one balanced ledger
entry) is unchanged.

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manager maintains an item's five price tiers (Priority: P1)

An authorized user sets, on the item card, up to **five sale prices** — one per tier (commercial,
semi-commercial, wholesale, semi-wholesale, consumer). Editing a tier never alters already-posted invoices.

**Why this priority**: Without tier prices on items there is nothing to sell from; it is the master data
the whole feature draws on (the A5Group item-card pricing block).

**Independent Test**: Set the five tiers for a product; read them back; change one and confirm a
previously posted invoice keeps its original price.

**Acceptance Scenarios**:

1. **Given** a product, **When** an authorized user sets prices for the five tiers, **Then** each tier
   price is stored (money ≥ 0) and retrievable on the item card.
2. **Given** an item with tier prices, **When** a tier price is edited, **Then** previously posted
   invoice lines keep their original price (snapshot, no rewrite).
3. **Given** an item with **no** price set for a tier, **When** that tier is used, **Then** the item's
   base `sale_price` is used as the fallback (backward-compatible with 002).

---

### User Story 2 - Customer carries a default price tier (Priority: P1)

An authorized user assigns each customer a **default price tier**, so sales lines for that customer
pre-fill at the right tier without manual selection each time.

**Why this priority**: The default tier is what makes tiered pricing usable at speed (A5Group's
"per-customer default tier"); it pairs with US1 to drive the invoice.

**Independent Test**: Set a customer's default tier to "wholesale"; start a sale for them and confirm a
line pre-fills at the item's wholesale price.

**Acceptance Scenarios**:

1. **Given** a customer, **When** an authorized user sets their default price tier, **Then** it is stored
   and returned on the customer card.
2. **Given** a customer with **no** default tier, **When** a sale is started, **Then** the **consumer**
   tier is used as the default.
3. **Given** a customer with a default tier, **When** a sale line is added without an explicit tier,
   **Then** the line's price resolves from the customer's default tier.

---

### User Story 3 - Seller prices a sale line by tier, with override (Priority: P1)

When adding a sale line, the seller gets the customer's default tier pre-filled but may **switch the tier
per line**; the line price resolves from the chosen tier. The seller may also type a manual unit price —
but **selling below** the chosen tier's price is rejected unless they hold the `sell.below_price`
capability. The chosen tier and the actual unit price are recorded on the line.

**Why this priority**: This is where the tiers are actually applied and where the below-price control
lives (A5Group's per-invoice tier choice + "بيع تحت السعر" permission) — the headline behaviour.

**Independent Test**: As a role **without** `sell.below_price`, post a line below the tier price → rejected;
at/above → allowed. As a role **with** it → below is allowed. The line stores the tier + the actual price.

**Acceptance Scenarios**:

1. **Given** a sale line with no explicit tier, **When** posted, **Then** its price is the customer's
   default-tier price for that item (or consumer/base fallback), and the line records that tier.
2. **Given** a sale line with an **explicit tier**, **When** posted, **Then** the line price resolves from
   that tier and the line records it.
3. **Given** a manual unit price **below** the resolved tier price and a seller **without**
   `sell.below_price`, **When** posted, **Then** it is **rejected**.
4. **Given** a manual unit price below the tier and a seller **with** `sell.below_price`, **When** posted,
   **Then** it is **allowed** and the actual price is recorded.
5. **Given** a manual unit price **at or above** the tier price, **When** posted, **Then** it is allowed
   for any seller (selling above the tier is never restricted).
6. **Given** any sale, **When** the invoice is posted, **Then** discount, cash/credit split, and the one
   balanced ledger entry behave exactly as in 002 (tiers only set the line price).

---

### Edge Cases

- A tier with no price for an item falls back to the item's base `sale_price`; if neither exists, the sale
  line is rejected (no price to charge).
- Editing tier prices or a customer's default tier never rewrites posted invoice lines (snapshot).
- A manual unit price equal to the tier price is allowed (not "below").
- Below-tier check uses the **resolved tier price for that item**, not a global number.
- A non-product item still cannot be sold (002 rule unchanged).
- Sales Reps (no `sell.below_price`) cannot sell below tier; managers can (role mapping).

## Requirements *(mandatory)*

### Functional Requirements

#### Item tier prices

- **FR-001**: An item MUST support **five named sale price tiers** — commercial, semi-commercial,
  wholesale, semi-wholesale, consumer — each an editable money value ≥ 0 (independent of the base
  `sale_price`).
- **FR-002**: Editing a tier price MUST NOT alter already-posted invoice lines (snapshot at sale time).
- **FR-003**: When a tier has no explicit price for an item, the item's base `sale_price` MUST be used as
  the fallback (backward-compatible with 002).

#### Customer default tier

- **FR-004**: A customer MUST support an optional **default price tier**; when unset, the **consumer** tier
  is the default.

#### Pricing a sale line

- **FR-005**: A sale line's price MUST resolve from a **tier**: the line's explicit tier if given, else the
  customer's default tier (else consumer). The resolved **tier** MUST be recorded on the invoice line.
- **FR-006**: A sale line MAY carry a **manual unit price**. If the manual price is **below** the resolved
  tier price, the actor MUST hold the **`sell.below_price`** capability or the line is rejected; a price
  **at or above** the tier price is always allowed.
- **FR-007**: The invoice line MUST record both the **resolved tier** and the **actual unit price** charged
  (for audit and reporting).
- **FR-008**: All downstream sale behaviour (discount %, cash/credit split summing to net, the single
  balanced ledger entry, stock-out, returns) MUST be **unchanged** from 002 — tiers only set the line price.

#### Access control

- **FR-009**: Setting item tier prices uses the existing **catalog.write** capability; setting a customer's
  default tier uses **customer.write**. A new **`sell.below_price`** capability MUST gate below-tier
  selling and be granted to System Admin, Branch Manager, and Sales Manager (NOT Sales Rep) by default.

### Key Entities *(include if feature involves data)*

- **Price Tier**: An enum of five values — commercial, semi-commercial, wholesale, semi-wholesale,
  consumer.
- **Item Price (new)**: A per-item, per-tier price — `item_id`, `tier`, `price` (money), unique on
  (item_id, tier). Additive to the item; the base `item.sale_price` remains as the fallback.
- **Customer (extended)**: gains `default_price_tier` (nullable enum; consumer when unset).
- **Sales Invoice Line (extended)**: gains `price_tier` (the resolved tier snapshot); keeps `unit_price`
  (now the actual charged price, which may equal/exceed/—with capability—undercut the tier price).

*(Reused, not redefined: Item, Customer, SalesInvoice, the sales/ledger/stock services, RBAC, audit.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An item can hold five distinct tier prices; 100% of posted lines snapshot the price (later
  edits never change a posted line).
- **SC-002**: A sale line with no explicit tier prices at the customer's default tier (or consumer/base
  fallback) in 100% of cases, and records the tier used.
- **SC-003**: 100% of below-tier lines by a seller without `sell.below_price` are rejected; 100% of
  at/above-tier lines are accepted for any seller.
- **SC-004**: Discount, cash/credit split, and the single balanced ledger entry are unchanged from 002 in
  100% of sales (no regression).

## Assumptions

- The five tiers are a **fixed enum** (matching A5Group's named tiers), not a user-defined list, in this
  sub-feature.
- The base `item.sale_price` stays as the **fallback** price and is not removed (keeps 002 data/tests
  valid); the "consumer" tier without an explicit price equals the base price.
- "Below price" is checked against the **resolved tier price for that specific item**; there is no global
  minimum.
- Per-customer **per-item** indicative prices, slab/quantity pricing, and time-phased price changes are
  **out of scope** (later sub-features).

## Out of Scope *(deferred to their own specs)*

- Multiple units per item + conversion factor; serial numbers; barcode; min/max & expiry; cost valuation
  (the rest of S06).
- Slab/quantity-break pricing; time-phased (date-effective) price tables; per-customer per-item prices.
- Purchase-side tiers; multi-currency; VAT.

## Clarifications

### Session 2026-06-29

- Q: How is the tier chosen on a sale line? → A: **Customer default pre-fills, seller may override per
  line** (FR-004/005).
- Q: Selling below the chosen tier price? → A: **Allowed only with a new `sell.below_price` capability**
  (FR-006/009).
- Q: Scope of this sub-feature? → A: **Price tiers only**; units/serials/barcode deferred (Out of Scope).
