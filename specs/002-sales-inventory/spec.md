# Feature Specification: Sales & Inventory

**Feature Branch**: `002-sales-inventory`
**Created**: 2026-06-25
**Status**: Draft
**Input**: User description: "Specify the Sales & Inventory feature, building on Foundation (001) and conforming to constitution v1.2.0 — catalog (raw materials + products), stock per location, suppliers & purchases, decoupled manufacturing, sales invoices, stock transfers, and returns/reversals."

## Context & Dependencies

This feature builds on **Foundation (001)** and MUST reuse — never redefine — its primitives:

- **Users / RBAC / scoping** — server-side capability checks, branch isolation, rep-only scoping.
- **Branches / territories / warehouses / per-rep custodies** — the locations stock lives in.
- **Customers + ledger-derived receivable accounts (ذمم)** — the credit-sale counterparty.
- **Immutable double-entry ledger + treasury** — the single money source of truth; every monetary
  effect here posts to it, and every operation's reversal is a new linked ledger entry (Principle IV).

All money is EGP; UI is Arabic/RTL (presentation is a client concern). No VAT.

## Clarifications

### Session 2026-06-25

- Q: Are returns partial (quantity-level) or full-only? → A: Partial returns allowed — each return is
  a new linked record with its own quantities; cumulative returned per line ≤ the original quantity;
  each return is itself reversible.
- Q: Do purchases support supplier credit (آجل)? → A: Yes — a purchase carries cash + credit amounts
  (like sales); the credit portion posts to a supplier-payable account (a new ledger account type
  mirroring customer receivable), the cash portion to treasury/custody, in one balanced entry.
- Q: Does the financial ledger track inventory value (asset + COGS)? → A: No — stock is quantity-only;
  the money ledger tracks cash, customer receivables, and supplier payables only. Inventory-asset
  valuation and COGS are out of scope, deferred to a later accounting/reporting spec.
- Q: What precision/unit do stock quantities use? → A: Decimal quantities for all items, with a
  per-item unit of measure (e.g., kg, L, piece). No separate integer/decimal split by kind.
- Q: Where does the cash portion of a rep's sale post? → A: To the **actor's cash location** — a rep's
  cash sale posts to their custody (عهدة); a branch/back-office cash sale to the branch treasury/custody.
  Moving custody→central treasury is a separate handover operation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Purchasing Manager sets up raw materials, suppliers, and records purchases (Priority: P1)

A Purchasing Manager defines raw-material catalog items and suppliers, then records purchase
invoices that bring raw materials into a branch location, increasing that location's stock.

**Why this priority**: Without raw materials in stock there is nothing to manufacture; purchasing is
the inbound entry point of the whole inventory chain.

**Independent Test**: Create a raw material and a supplier, record a purchase of quantity 100 into
Branch A's warehouse, and confirm that location's on-hand for the item is 100 and a cost entry posted
to the ledger.

**Acceptance Scenarios**:

1. **Given** a Purchasing Manager, **When** they create a raw material, **Then** it has a
   system-generated (editable) code, a purchase price, an active flag, and is marked "never sold".
2. **Given** a supplier and a destination location, **When** the manager records a purchase invoice
   of N units at a stated unit price, **Then** the location's raw-material on-hand increases by N and
   the purchase price recorded is the per-invoice price (not necessarily the item's reference price).
3. **Given** a recorded purchase, **When** it is reversed (purchase return), **Then** the raw
   material leaves stock and the money effect is reversed via a new linked ledger entry (Principle IV);
   the original purchase is never edited or deleted.
4. **Given** a purchase return that would drive the location's on-hand below zero, **When** submitted,
   **Then** it is rejected (Principle XI — no negative stock).
5. **Given** a purchase totalling 1000 with 400 paid cash and 600 on supplier credit, **When**
   recorded, **Then** one balanced Foundation entry posts 400 against treasury/custody and 600 to the
   supplier's payable account, and the supplier's ledger-derived payable balance increases by 600.

---

### User Story 2 - Manager defines products with a fixed sale price (Priority: P1)

A manager defines product catalog items (manufactured in-house, sold to customers) each carrying a
single fixed sale price.

**Why this priority**: Products are what the business sells; they must exist before manufacturing or
sales can reference them.

**Independent Test**: Create a product with a sale price; confirm it has an editable code, is marked
"manufactured / sold", and that it cannot be purchased from a supplier.

**Acceptance Scenarios**:

1. **Given** a manager, **When** they create a product, **Then** it has a system-generated (editable)
   code, exactly one fixed sale price, and an active flag.
2. **Given** a product, **When** a user attempts to add it to a purchase invoice, **Then** the system
   rejects it (products are manufactured, not purchased).
3. **Given** a raw material, **When** a user attempts to add it to a sales invoice, **Then** the
   system rejects it (raw materials are consumed, never sold).

---

### User Story 3 - Production consumes raw material and produces product (decoupled) (Priority: P2)

Manufacturing is two **independent** stock operations: (a) consume raw material at a location, and
(b) produce/add product at any chosen location. They are not tied and not recipe/BOM-driven; the user
states the quantity for each operation separately.

**Why this priority**: Converts inputs to sellable goods, but depends on purchasing (US1) and the
product catalog (US2) existing first.

**Independent Test**: Consume 30 units of a raw material at Central (on-hand drops by 30), separately
produce 10 units of a product at Central (product on-hand rises by 10); confirm the two operations are
independent records with no enforced linkage.

**Acceptance Scenarios**:

1. **Given** raw-material on-hand of 50 at a location, **When** a consumption of 30 is recorded,
   **Then** on-hand becomes 20 and an immutable consumption movement is recorded.
2. **Given** a consumption of 60 against on-hand of 50, **When** submitted, **Then** it is rejected
   (Principle XI).
3. **Given** a production operation, **When** the user records producing 10 of a product at a chosen
   location, **Then** that location's product on-hand increases by 10, with no required link to any
   consumption.
4. **Given** a consumption or production, **When** reversed, **Then** a mirror reversal movement is
   recorded (consumption↔return-to-stock, production↔un-produce), never a mutation (Principle IV).

---

### User Story 4 - Sales Rep sells products to a customer (Priority: P1)

A Sales Rep creates a sales invoice for products to one of their own customers, decrementing product
stock at the originating location immediately. The invoice is printable, has no VAT, and applies a
single combined percentage discount (fixed settings % + variable per-invoice %) once to the gross. The
invoice splits its net total into a cash-paid amount (to the actor's cash location — the rep's own
custody for a rep sale) and a credit amount (to the customer's receivable), either of which may be
zero, posted in one balanced Foundation ledger entry.

**Why this priority**: This is the core revenue action of the system and the primary mobile rep flow.

**Independent Test**: As a rep with 5 units of a product in their custody, create a sales invoice for
3 units to an own customer; confirm custody on-hand drops to 2, the invoice prints, discounts apply,
and the money posts to the correct Foundation account.

**Acceptance Scenarios**:

1. **Given** a rep with product on-hand of 5 at their custody, **When** they invoice 3 units to an own
   customer, **Then** custody on-hand becomes 2 and the sale is recorded against the originating
   location only (Principle V).
2. **Given** a sale that would drive on-hand below zero, **When** submitted, **Then** it is rejected
   (Principle XI).
3. **Given** a gross of 1000 with a fixed settings discount of 5% and a variable per-invoice discount
   of 10%, **When** totals are computed, **Then** a single combined 15% is applied once to the gross
   (net = 850), no VAT is added, and the result is printable.
4. **Given** a **rep** sale with a net total of 850, **When** the rep enters a cash-paid amount of 300
   and a credit amount of 550, **Then** the system records both (sum = 850), posts the 300 cash portion
   to the **rep's own custody (عهدة)** and the 550 credit portion to the customer's receivable account
   in one balanced Foundation ledger entry; either portion MAY be zero (fully cash or fully credit).
5. **Given** a recorded sale, **When** a sales return is processed, **Then** the returned products
   re-enter stock and the money effect reverses out of the treasury/customer account via a new linked
   ledger entry (Principle IV).

---

### User Story 5 - Branch Manager approves stock transfers between locations (Priority: P2)

Formal stock transfers move items between locations (central→branch, central→rep, rep→rep). A transfer
requires Branch Manager approval; on approval it atomically decrements the source and increments the
destination, obeying no-negative-stock.

**Why this priority**: Distributes stock to where it is sold, but depends on stock existing (US1/US3).

**Independent Test**: Initiate a transfer of 20 units central→rep, have the Branch Manager approve it,
and confirm source drops by 20 and destination rises by 20 in one atomic, reversible operation.

**Acceptance Scenarios**:

1. **Given** an initiated transfer, **When** it is pending approval, **Then** no stock has moved yet.
2. **Given** a pending transfer, **When** the Branch Manager approves it, **Then** source on-hand
   decreases and destination on-hand increases by the same quantity atomically.
3. **Given** an approved transfer that would drive the source below zero, **When** evaluated, **Then**
   it is rejected (Principle XI).
4. **Given** an approved transfer, **When** reversed, **Then** a reverse-transfer moves the stock back
   via a new linked record (Principle IV).
5. **Given** the supported routes, **When** a transfer is initiated, **Then** only central→branch,
   central→rep, and rep→rep routes are permitted.

---

### User Story 6 - Staff process returns and reversals (Priority: P2)

Any financial or stock-affecting operation in this feature (purchase, consumption, production, sale,
transfer) has a defined mirror reversal, recorded as a new linked entry — never a mutation.

**Why this priority**: Correctness/auditability of the whole feature; cross-cutting over US1–US5.

**Independent Test**: For each operation type, perform it then reverse it and confirm stock and money
return to their prior state via new linked records with the originals intact.

**Acceptance Scenarios**:

1. **Given** any operation, **When** reversed, **Then** the reversal is a new record linked to the
   original; the original is never edited or deleted.
2. **Given** a sales return, **When** processed, **Then** products return to the originating location's
   stock and the money effect is reversed **proportionally** in the original invoice's cash/credit
   split (the caller supplies only the returned quantities).
3. **Given** a purchase return, **When** processed, **Then** raw materials leave the location's stock
   back to the supplier and the cost effect is reversed.
4. **Given** a sale of 5 units, **When** 2 units are returned and later 1 more is returned, **Then**
   both partial returns are accepted (cumulative 3 ≤ 5), each a new linked record, and a further return
   exceeding the remaining 2 units is rejected.

---

### Edge Cases

- An operation that would make any (item × location) quantity negative MUST be rejected with a clear
  error, not recorded as a deficit (Principle XI).
- A sale, transfer, or consumption referencing a deactivated item or location MUST be rejected.
- A reversal of an already-reversed operation MUST be rejected (reverse-once, consistent with the
  Foundation ledger).
- A rep selling a product they do not hold at their own custody MUST be rejected (rep stock isolation +
  no negative stock).
- Concurrent operations on the same (item × location) MUST not allow the combined effect to go below
  zero (the no-negative-stock check is evaluated against the committed quantity).
- Editing an item's reference price (raw-material purchase price or product sale price) MUST NOT alter
  the price recorded on already-posted purchases or sales (history is immutable).

## Requirements *(mandatory)*

### Functional Requirements

#### Catalog (two item kinds)

- **FR-001**: System MUST maintain one shared catalog containing exactly two item kinds: **raw
  material** and **product**.
- **FR-002**: Each item MUST have a system-generated code that is **editable**, an active flag, and a
  **unit of measure** (e.g., kg, L, piece).
- **FR-002a**: Stock quantities MUST be stored as **decimals** (fractional quantities allowed, e.g.,
  2.5 kg) for all item kinds; there is no integer-only restriction.
- **FR-003**: A raw material MUST have a purchase (reference) price, MUST be purchasable and
  consumable, and MUST NOT be sellable.
- **FR-004**: A product MUST have exactly one fixed sale price, MUST be manufacturable and sellable,
  and MUST NOT be purchasable from a supplier.
- **FR-005**: Quantity MUST be tracked per (item × location); the system MUST NOT store a quantity on
  the item itself.

#### Stock & No-Negative-Stock

- **FR-006**: Every item kind MAY be stored at any warehouse or per-rep custody location.
- **FR-007**: Every stock change MUST be recorded as an immutable stock movement with a defined mirror
  reversal; on-hand per (item × location) MUST be derivable from movements.
- **FR-008**: Any sale, consumption, or transfer that would reduce an (item × location) quantity below
  zero MUST be rejected — never recorded as a deficit (Principle XI).
- **FR-008a**: Stock is **quantity-only**: stock movements carry no monetary value. The financial
  ledger tracks only cash, customer receivables, and supplier payables. Inventory-asset valuation and
  cost-of-goods-sold (COGS) are **out of scope** for this feature (deferred to a later accounting/
  reporting spec).

#### Suppliers & Purchases

- **FR-009**: System MUST maintain suppliers.
- **FR-010**: A purchase invoice MUST bring one or more raw materials into a specified location,
  increasing that location's raw-material on-hand.
- **FR-011**: The unit price on a purchase invoice line MAY differ per purchase and MUST be recorded on
  the invoice; it MUST NOT overwrite the item's reference price or any prior purchase.
- **FR-012**: A purchase MUST post its monetary effect through the Foundation ledger as **one balanced
  entry** carrying a **cash-paid amount** and a **credit amount** (summing to the purchase total;
  either MAY be zero). The cash portion posts to the treasury/custody; the credit portion posts to a
  **supplier-payable account** (a ledger account type mirroring the customer receivable). A purchase
  MUST support **purchase returns** that remove raw materials and reverse the money effect
  **proportionally and automatically in the same cash/credit composition as the original purchase**
  (reducing supplier payable and treasury/custody in that proportion). Returns MAY be **partial**
  (per-line quantities); the caller provides only returned lines/quantities; cumulative returned
  quantity per line MUST NOT exceed the purchased quantity; and each return is itself a new linked,
  reversible record.

#### Manufacturing (decoupled)

- **FR-013**: Consuming raw material and producing a product MUST be two **independent** stock
  operations, not a single tied transaction and not recipe/BOM-driven.
- **FR-014**: A consumption MUST decrement raw-material on-hand at a stated location by a user-stated
  quantity (subject to FR-008).
- **FR-015**: A production MUST increment product on-hand at a user-chosen location by a user-stated
  quantity, with no required linkage to any consumption.
- **FR-016**: Consumption and production MUST each be **reversible** via an explicit reverse operation
  that creates a new linked mirror stock movement (consumption↔return-to-stock, production↔un-produce),
  never a mutation, reversible at most once (Principle IV).

#### Sales Invoices

- **FR-017**: A sales invoice MUST sell only products, to a customer, and MUST immediately decrement
  product on-hand at the originating location only (Principle V), subject to FR-008.
- **FR-018**: A sales invoice MUST be printable and MUST NOT include VAT.
- **FR-019**: Both sales discounts are **percentages**: a fixed percentage from settings and a
  variable per-invoice percentage entered at invoice time. They MUST be combined into a single
  percentage and applied **once** to the invoice gross total:
  `combined_discount_% = fixed_% + variable_%`, then `net = gross × (1 − combined_discount_%/100)`
  (e.g., 5% + 10% = 15% off a gross of 1000 → net 850). No amount-based discount is supported.
- **FR-020**: A sales invoice MUST carry a **cash-paid amount** and a **credit amount** whose sum
  equals the invoice total after discount; either MAY be zero (fully cash or fully credit). The cash
  portion MUST post to the **actor's cash location** — a Sales Rep's sale to their own custody (عهدة),
  a branch/back-office sale to the branch treasury/custody — and the credit portion to the customer's
  receivable account (ذمم), both through the Foundation ledger in **one balanced entry**. Moving cash
  from a custody to the central treasury is a separate handover operation, not part of the sale.
- **FR-021**: A sales invoice MUST support **sales returns** that return products to the originating
  location's stock and reverse the money effect **proportionally and automatically in the same
  cash/credit composition as the original invoice** (e.g., a 40% cash / 60% credit invoice refunds 40%
  to the cash location and reduces the customer receivable by 60% of the returned value), via a new
  linked ledger entry. Returns MAY be **partial** (per-line quantities); the caller provides only
  returned lines/quantities (not the money split); cumulative returned quantity per line MUST NOT
  exceed the sold quantity; and each return is itself a new linked, reversible record.

#### Stock Transfers

- **FR-022**: System MUST support formal stock transfers on the routes central→branch, central→rep,
  and rep→rep only.
- **FR-023**: A transfer MUST require **Branch Manager approval** before any stock moves, by the Branch
  Manager who manages the **source location's branch**. For central→branch and central→rep (source is
  the central warehouse), the head-office/central authority approves. A manager of a non-source branch
  MUST be denied.
- **FR-024**: On approval, a transfer MUST atomically decrement the source and increment the
  destination by the same quantity (subject to FR-008), and MUST have a mirror **reverse-transfer**.

#### Reversibility (cross-cutting)

- **FR-025**: Every financial or stock-affecting operation (purchase, consumption, production, sale,
  transfer) MUST have a defined inverse recorded as a **new linked record**; originals are never edited
  or deleted (Principle IV). A **full reversal** of an operation MAY occur at most once. **Returns**
  (sales/purchase) MAY instead be **partial and repeated** as new linked records, provided the
  cumulative returned quantity per line never exceeds the original.

#### Access Control & Scoping

- **FR-026**: All operations MUST enforce Foundation RBAC server-side (deny-by-default) and respect
  branch isolation and rep-only scoping; a Sales Rep MUST act only on their own custody/customers.
- **FR-027**: Transfer approval MUST be restricted to the Branch Manager role.
- **FR-028**: The system MUST enforce the following role→capability mapping server-side:
  - **Create sales invoices** — Sales Rep (mobile), Sales Manager, and Branch Manager.
  - **Manufacture** (record raw-material consumption and product production) — Branch Manager and
    Purchasing Manager.
  - **Record purchases** — Purchasing Manager.
  - **Approve transfers** — Branch Manager (per FR-027).

#### Settings

- **FR-029**: The fixed sales discount **percentage** MUST be configurable at runtime in settings (not
  hardcoded), and changes MUST NOT alter discounts already recorded on posted invoices.

### Key Entities *(include if feature involves data)*

- **Item (Catalog)**: Shared catalog record with a kind (raw_material | product), an editable
  system-generated code, a **unit of measure**, an active flag; raw materials carry a purchase
  reference price, products carry one fixed sale price. No quantity stored on the item.
- **Stock Movement**: An immutable record of a **decimal** quantity change for an (item × location)
  with a type (purchase_in, consumption_out, production_in, sale_out, transfer_out, transfer_in, and
  their reversals) and an optional link to a mirror reversal. Quantity-only — carries no monetary
  value. On-hand is derived from these.
- **Supplier**: A vendor raw materials are purchased from; has a linked supplier-payable account.
- **Supplier Account (Payables)**: A running payable per supplier; balance derived from the Foundation
  ledger (mirrors the customer-receivable pattern); the credit portion of purchases posts here and is
  settled by separate payments.
- **Purchase Invoice**: Brings raw materials into a location at per-invoice unit prices; carries a
  cash-paid amount and a credit amount (summing to the total, either may be zero) posting to
  treasury/custody and the supplier-payable account in one balanced Foundation ledger entry; reversible
  as a (possibly partial) purchase return.
- **Sales Invoice**: Sells products to a customer from an originating location; applies a single
  combined percentage discount (fixed settings % + variable per-invoice %) once to the gross; no VAT;
  printable; carries a cash-paid amount and a credit amount (summing to the net total, either may be
  zero) that post to the actor's cash location (rep custody or branch treasury/custody) and the
  customer's receivable respectively in one balanced Foundation ledger entry; reversible as a
  (possibly partial) sales return.
- **Stock Transfer**: A pending→approved movement between two locations on allowed routes; Branch
  Manager-approved; reversible as a reverse-transfer.
- **Settings (Sales)**: Runtime configuration, including the fixed sales discount.

*(Referenced from Foundation, not redefined: User, Role, Branch, Territory, Warehouse, Custody,
Customer, Customer Account, Treasury, Ledger Entry/Line, Audit Log.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of operations that would create negative (item × location) stock are rejected, across
  sales, consumption, and transfers.
- **SC-002**: Every (item × location) on-hand equals the signed sum of its stock movements in 100% of
  checks (no standalone stored quantity disagrees).
- **SC-003**: Every operation type (purchase, consumption, production, sale, transfer) can be reversed,
  returning stock and money to the prior state via a new linked record, with the original intact — and a
  second reversal of the same operation is rejected.
- **SC-004**: A Sales Rep can create a sales invoice for an own customer from their custody, with stock
  decremented and money posted to the correct Foundation account, end to end.
- **SC-005**: 100% of cross-rep and cross-branch attempts to act on stock not in the actor's scope are
  denied server-side.
- **SC-006**: Sales totals apply a single combined percentage discount (fixed % + variable %) once to
  the gross with no VAT, the net splits into cash + credit amounts summing to the net, and a printable
  invoice is produced.

## Assumptions

- Stock on-hand is derived from immutable stock movements (consistent with the Foundation ledger
  philosophy); no editable quantity field is stored on items or locations.
- **Supplier credit**: Purchases support supplier credit (آجل) — see Clarifications. A purchase carries
  cash + credit amounts; the credit portion posts to a supplier-payable account (a ledger account type
  mirroring the customer receivable), the cash portion to treasury/custody, in one balanced Foundation
  ledger entry. Payable balances are ledger-derived; settlement payments are separate ledger postings.
- Item reference prices (raw-material purchase price, product sale price) are editable going forward but
  never rewrite prices already recorded on posted purchases/sales.
- Manufacturing records who produced/consumed and where, for audit, reusing the Foundation audit log.
- **Payment type (resolved Q1)**: A sales invoice carries a cash-paid amount and a credit amount whose
  sum equals the net total; either may be zero (fully cash or fully credit). The cash portion posts to
  the treasury/custody and the credit portion to the customer's receivable, in one balanced Foundation
  ledger entry.
- **Discount combination (resolved Q2)**: Both discounts are percentages; `combined_% = fixed_% +
  variable_%` applied once to the gross. No amount-based discount exists.
- **Manufacture/sell roles (resolved Q3)**: Sales invoices — Sales Rep, Sales Manager, Branch Manager;
  manufacturing — Branch Manager, Purchasing Manager; purchasing — Purchasing Manager; transfer
  approval — Branch Manager.
- Loyalty points/coupons, offline sync mechanics, and employees are out of scope (separate specs).

## Out of Scope *(deferred to their own specs)*

- Loyalty points and coupons (After-Sales spec).
- Offline sync mechanics — this spec defines **server-side** behavior; the rep's offline mirror is
  spec 4.
- Employees, salaries, advances.
- VAT/tax handling (explicitly excluded).
- Inventory-asset valuation and cost-of-goods-sold (COGS) — stock is quantity-only here; valuation
  and profit reporting are deferred to a later accounting/reporting spec.
