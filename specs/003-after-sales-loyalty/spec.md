# Feature Specification: After-Sales Loyalty (Points & Coupons)

**Feature Branch**: `003-after-sales-loyalty`
**Created**: 2026-06-27
**Status**: Draft
**Input**: User description: "After-Sales Loyalty — per-product point values, earning points on sales,
manual points→coupons conversion, and coupon redemption (money/gift), building on Foundation (001) and
Sales & Inventory (002), conforming to constitution v1.3.0."

## Context & Dependencies

This feature builds on **Foundation (001)** and **Sales & Inventory (002)** and MUST reuse — never
redefine — their primitives:

- **Customers + ledger-derived receivable accounts (ذمم)** — the loyalty counterparty.
- **Immutable double-entry ledger + treasury** — the single money source of truth; all money effects
  here post to it as **balanced entries**; balances stay ledger-derived.
- **Products + stock movements (002 stock service)** — a gift coupon redeemed as a product creates a
  stock movement subject to No-Negative-Stock (Principle XI).
- **Sales invoices (002)** — the event that earns points; its return reverses them.
- **RBAC** — server-side, deny-by-default; **After-Sales Staff** is the primary actor.

All money is EGP; UI is Arabic/RTL (presentation is a client concern). No VAT.

## Clarifications

### Session 2026-06-27

- Q: How is a coupon's value/type determined? → A: Settings define a **catalog of coupon types**, each
  with a kind (money|gift), a point cost (rate), and a value/denomination; staff pick a type at
  conversion.
- Q: Is a gift coupon's redemption mode (product vs money-off) and product/quantity fixed at issuance? →
  A: No — the gift coupon carries a value; the mode and the specific product/quantity are chosen at
  **redemption** time (a product whose value ≤ the coupon value, or money-off up to the coupon value).
- Q: Does redeeming a gift coupon as a product post a money/ledger effect? → A: No — it is **stock-only**
  (decrements stock, no ledger entry), consistent with 002's quantity-only inventory (no COGS).
- Q: How is a gift "money-off" redemption posted to the ledger? → A: **Identically to a money coupon** —
  debit `loyalty_expense`, credit `customer_receivable` for the coupon value (one balanced entry).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - After-Sales Staff sets per-product point values (Priority: P1)

After-Sales Staff assign and edit a point value on each product, defining how many loyalty points a
purchase of that product earns.

**Why this priority**: No points can be earned until products carry point values; this is the seed of
the whole loyalty model.

**Independent Test**: Set a product's point value to 5, change it to 8, and confirm the current value
is 8 and that the change does not retroactively alter points already earned on past invoices.

**Acceptance Scenarios**:

1. **Given** an existing product, **When** After-Sales Staff set its point value, **Then** the product
   carries that editable point value (the 002 catalog is extended, not broken).
2. **Given** a product with point value 5, **When** the value is changed to 8, **Then** future sales
   earn 8/unit while points already earned on prior invoices are unchanged (snapshot at earn time).

---

### User Story 2 - Customer earns points when a sale is invoiced (Priority: P1)

When a sales invoice (002) is created, the customer automatically earns the sum of (product point value
× quantity) across its product lines, regardless of whether the sale is cash or credit. A sales return
reverses the points it originally earned.

**Why this priority**: Earning is the core value loop; without it there is nothing to convert or redeem.

**Independent Test**: Invoice 3 units of a product worth 5 points → customer earns 15 points; return 1
unit → 5 points are reversed, leaving 10.

**Acceptance Scenarios**:

1. **Given** a sales invoice with lines totalling 15 product-points, **When** the invoice is created,
   **Then** the customer's earned points increase by 15, recorded as an immutable earn record.
2. **Given** a cash sale and an equivalent credit sale, **When** each is invoiced, **Then** both earn
   the same points (cash/credit does not change earning).
3. **Given** a prior earn of 15 from an invoice, **When** a partial sales return of that invoice is
   processed, **Then** the points for the returned quantity are reversed via a new record **linked to
   the original earn** (Principle IV), reducing the balance accordingly.
4. **Given** earned points already converted into a coupon that is **not yet redeemed**, **When** the
   earning invoice is returned, **Then** the coupon is **voided** to reclaim its points (a new linked
   record) and the return is not blocked.
5. **Given** earned points already converted into a coupon that is **already redeemed**, **When** the
   earning invoice is returned, **Then** a **negative point adjustment** is recorded (the balance may go
   negative, settled against future earnings) and the return is not blocked.

---

### User Story 3 - After-Sales Staff converts a customer's points into coupons (Priority: P1)

After-Sales Staff manually convert a customer's available points into one or more coupons by selecting
**coupon types** from the settings catalog (each type defines kind, point cost, and value). Each issued
coupon gets a unique serial/ID and snapshots its type; the conversion consumes the points.

**Why this priority**: Coupons are the redeemable artifact; conversion turns earned points into value.

**Independent Test**: With a customer holding 100 points and a rate of 50 points/coupon, convert into 2
coupons; confirm 100 points are consumed, two coupons exist with distinct serials, and the balance is 0.

**Acceptance Scenarios**:

1. **Given** a customer with sufficient available points, **When** Staff convert points to coupons at
   the configured rate, **Then** the points are consumed (recorded immutably) and coupons are issued.
2. **Given** any two issued coupons, **When** their serials are compared, **Then** the serials are
   **unique** across the system.
3. **Given** a customer with insufficient available points, **When** a conversion is attempted, **Then**
   it is rejected (no negative point balance).
4. **Given** a coupon type costing 50 points and a customer holding 120 points, **When** Staff convert,
   **Then** at most 2 such coupons (100 points) may be issued, the remaining 20 points stay as balance,
   and issuing a coupon whose point cost exceeds the available balance is rejected (whole coupons only).

---

### User Story 4 - Redeem a money coupon against the customer's receivable (Priority: P2)

A money coupon reduces what the customer owes: its value is applied to the customer's receivable
account, and the coupon value is posted as a loyalty/marketing expense — one balanced Foundation ledger
entry. Redemption may occur on the customer's sales invoice or as a standalone invoice.

**Why this priority**: Money coupons are the primary redemption path and exercise the ledger extension.

**Independent Test**: Redeem a money coupon worth 50 against a customer; confirm the receivable is
reduced by 50 and 50 is posted to loyalty_expense in one balanced entry, and the coupon becomes redeemed.

**Acceptance Scenarios**:

1. **Given** an issued money coupon of value 50, **When** it is redeemed, **Then** the customer's
   receivable decreases by 50 and 50 is recorded as loyalty_expense in one balanced ledger entry.
2. **Given** a coupon already redeemed, **When** redemption is attempted again, **Then** it is rejected
   (a coupon redeems at most once).
3. **Given** a redeemed money coupon, **When** the redemption is reversed, **Then** the receivable and
   loyalty_expense effects reverse via a new linked entry and the coupon returns to issued.

---

### User Story 5 - Redeem a gift coupon as product or money-off (Priority: P2)

A gift coupon carries a value; at **redemption time** staff choose either a **product** (value ≤ the
coupon value, decrementing stock via the 002 stock service, subject to No-Negative-Stock, stock-only —
no ledger entry) or **money off** (posted like a money coupon: `loyalty_expense` / receivable).

**Why this priority**: Completes the redemption model and ties loyalty to inventory.

**Independent Test**: Redeem a gift coupon as 1 unit of a product → product stock at the chosen location
drops by 1; redeem another as money-off → the invoice's payable is reduced by the coupon value.

**Acceptance Scenarios**:

1. **Given** a gift coupon redeemed as a product (chosen at redemption, value ≤ coupon value), **When**
   redeemed, **Then** the product's stock at the chosen location is decremented via a stock movement
   with **no ledger entry** (stock-only), rejected if it would go negative (Principle XI).
2. **Given** a gift coupon redeemed as money off, **When** redeemed, **Then** the customer's receivable
   decreases by the coupon value and the same value posts to `loyalty_expense` in one balanced ledger
   entry (identical to a money coupon).
3. **Given** a redeemed gift coupon, **When** the redemption is reversed, **Then** the stock or money
   effect reverses via a new linked record and the coupon returns to issued.

---

### User Story 6 - After-Sales Staff manage loyalty settings (Priority: P2)

After-Sales Staff manage the runtime **coupon-type catalog** — each type's kind (money/gift), point
cost, and value — never hardcoded.

**Why this priority**: Conversion and coupon value depend on these settings; they must be editable.

**Independent Test**: Change a coupon type's point cost and confirm subsequent conversions use the new
cost while previously issued coupons are unaffected.

**Acceptance Scenarios**:

1. **Given** After-Sales Staff, **When** they add/edit a coupon type (kind, point cost, value), **Then**
   the new values apply to subsequent conversions only.
2. **Given** a non-After-Sales role, **When** they attempt to change loyalty settings, **Then** it is
   denied server-side.

---

### Edge Cases

- A coupon serial MUST be unique across the system; a collision MUST never be issued.
- A coupon redeems **at most once**; a second redemption is rejected.
- Converting more points than a customer has available MUST be rejected (no negative point balance).
- A gift-coupon product redemption that would drive stock below zero MUST be rejected (Principle XI).
- Every redemption (money or gift) and every conversion/earn MUST be reversible via a new linked record;
  originals are never edited or deleted (Principle IV).
- Editing a product's point value MUST NOT change points already earned on posted invoices.
- A standalone coupon redemption (no underlying sale) MUST still post a balanced ledger entry / valid
  stock movement as applicable.
- If the invoice that earned points is later returned but those points were already converted/redeemed,
  the return is never blocked: an unredeemed resulting coupon is **voided** to reclaim the points; an
  already-redeemed one yields a **negative point adjustment** (balance may go negative), settled against
  future earnings (FR-004).

## Requirements *(mandatory)*

### Functional Requirements

#### Per-Product Point Value

- **FR-001**: The system MUST allow After-Sales Staff to set and edit an integer **point value** per
  product (extending the 002 catalog without breaking it).
- **FR-002**: Editing a product's point value MUST NOT alter points already earned on posted invoices
  (earning snapshots the point value at invoice time).

#### Earning & Reversal

- **FR-003**: When a sales invoice (002) is created, the customer MUST earn `Σ(product point value ×
  quantity)` across its product lines, **regardless of cash or credit**, recorded as an immutable
  point-earn record linked to the invoice.
- **FR-004**: A sales return (002) MUST reverse the points earned for the **returned quantity** via a
  new point-reverse record **linked to the original earn** (Principle IV). The return MUST NOT be
  blocked even when those points were already converted/redeemed. When reversal meets
  already-consumed points:
  - (a) if the resulting coupon is **not yet redeemed**, the system MUST **void** that coupon to reclaim
    its points (a new linked void record), and
  - (b) if the coupon is **already redeemed**, the system MUST record a **negative point adjustment** so
    the customer's balance MAY go negative (owed points), settled against future earnings.
  All of this is recorded as new linked records; originals are never edited or deleted.

#### Customer Point Balance

- **FR-005**: A customer's available point balance MUST be **derived** from immutable point records
  (earn, reverse, converted, adjustment) — never stored as a standalone balance that can drift. The
  balance **MAY go negative** (owed points) as a result of a return against already-redeemed points
  (FR-004b); a negative balance is settled against future earnings.
- **FR-006**: Points are strictly **per-customer**; the system MUST NOT support transferring points
  between customers.

#### Points → Coupons (manual)

- **FR-007**: After-Sales Staff MUST be able to manually convert a customer's available points into one
  or more coupons by selecting a **coupon type** from the settings catalog (each type defines kind,
  point cost, and value). Conversion happens in **whole-coupon increments** — each issued coupon
  consumes its type's point cost; total consumed = `Σ(per-type point cost)` (recorded immutably). Any
  remainder of points below the cheapest selectable coupon stays as the customer's point balance.
- **FR-008**: A conversion MUST be rejected if the selected coupon type's point cost exceeds the
  customer's available points (a conversion never produces a negative balance and never issues a partial
  coupon).

#### Coupons

- **FR-009**: Each coupon MUST have a **unique serial/ID**, a **type** (money | gift), and a **value**.
- **FR-010**: A coupon MUST be redeemable **at most once**; the system MUST track coupon status
  (issued | redeemed | voided). Reversing a redemption returns the coupon to **issued** (the redemption
  record is the reversed artifact, not the coupon).

#### Redemption

- **FR-011**: A **money** coupon MUST redeem against the customer's **receivable account** (reducing
  what they owe), with the coupon value posted as **loyalty_expense** — one balanced Foundation ledger
  entry.
- **FR-012**: A **gift** coupon carries a value; its redemption **mode and target are chosen at
  redemption time** (not fixed at issuance), as either:
  - a **product** — staff pick a product whose value ≤ the coupon value; this **decrements stock**
    via the 002 stock service (subject to No-Negative-Stock, Principle XI) and is **stock-only**
    (no ledger entry — consistent with 002's quantity-only inventory); or
  - **money off** — posted **identically to a money coupon**: debit `loyalty_expense`, credit the
    customer's `customer_receivable` for the coupon value, in one balanced Foundation ledger entry.
- **FR-013**: Redemption MAY occur on a customer's **sales invoice** or as a **standalone** invoice.
- **FR-014**: Every redemption (money or gift) MUST be **reversible** via a new linked record that
  reverses its money/stock effect; the original is never edited or deleted, and a redemption is
  reversible at most once (Principle IV).

#### Settings (runtime)

- **FR-015**: Loyalty settings MUST be managed at runtime by After-Sales Staff and MUST NOT be
  hardcoded: a **catalog of coupon types**, each with a kind (money | gift), a **point cost** (rate),
  and a **value/denomination**. Changes apply to subsequent conversions only (issued coupons
  unaffected — they snapshot their type's value/cost at issuance).

#### Access Control & Ledger

- **FR-016**: All loyalty operations MUST enforce Foundation RBAC server-side (deny-by-default).
  Managing point values, settings, conversions, and coupon issuance/redemption is restricted to
  **After-Sales Staff** (and System Admin). Point **earning** is an automatic effect of any permitted
  sale and requires no extra capability.
- **FR-017**: The money ledger MUST be extended with a **`loyalty_expense`** account type, additive to
  the existing ledger (like `supplier_payable` in 002) — **not** a new ledger; all loyalty money
  balances remain ledger-derived.

### Key Entities *(include if feature involves data)*

- **Product Point Value**: An editable integer point value attached to a product (extends the 002
  product). Snapshotted onto earn records at invoice time.
- **Point Record**: An immutable per-customer entry of kind earn (linked to a sales invoice),
  reverse (linked to a sales return + the original earn), converted (linked to a conversion), or
  adjustment (a negative settlement when a return must reverse already-redeemed points — see Q3). The
  point balance is the signed sum of these and **may go negative** (owed points). Points **never
  expire**; they persist until converted.
- **Coupon**: A redeemable artifact with a unique serial/ID, a **coupon-type reference** snapshotting
  kind (money | gift) and value/point-cost at issuance, owning customer, points consumed, and a status
  (issued | redeemed | voided). For a **gift** coupon the redemption mode (product or money-off) and
  target are decided at redemption, not at issuance. Coupons **never expire**; they persist until
  redeemed (or voided per Q3). There is no expiry-date field.
- **Coupon Redemption**: A record of redeeming a coupon — **money / gift-money-off** (debit
  `loyalty_expense`, credit receivable, one balanced entry) or **gift-product** (a stock movement only,
  no ledger entry); reversible via a linked record.
- **Coupon Type (Loyalty Settings)**: A runtime-managed catalog entry defining a coupon kind
  (money | gift), a point cost (rate), and a value/denomination. Conversion picks a type; the issued
  coupon snapshots its value/cost.

*(Reused from Foundation/Sales, not redefined: Customer, Customer Account, Ledger Entry/Line, Account —
with new `loyalty_expense` type, Product, Stock Movement, Sales Invoice, Sales Return, Role, Audit Log.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A product's point value is editable and a sale earns exactly `Σ(point value × quantity)`;
  100% of earning checks match, and editing the value never changes prior earnings.
- **SC-002**: A customer's point balance equals the signed sum of their point records (earn − reverse −
  converted ± adjustment) in 100% of checks (no standalone stored balance disagrees); the balance may be
  negative.
- **SC-003**: 100% of conversions that exceed available points are rejected; issued coupon serials are
  unique in 100% of cases.
- **SC-004**: A money coupon redemption reduces the receivable and posts loyalty_expense in one balanced
  ledger entry (Σdebit = Σcredit) in 100% of cases.
- **SC-005**: A gift-coupon product redemption decrements stock and is rejected if it would go negative
  in 100% of cases.
- **SC-006**: Every conversion, redemption, and earn is reversible via a new linked record with the
  original intact, and a second reversal/redemption of the same artifact is rejected.

## Assumptions

- **Back-office only**: loyalty actions (point values, settings, conversions, issuance, redemption) are
  performed by After-Sales Staff in the back office; the Sales Rep mobile flow does **not** issue or
  redeem coupons offline (offline sync is a separate spec).
- Points are **integers**; product point values are non-negative integers.
- Earning is automatic and synchronous with sales-invoice creation; the earned amount snapshots each
  product's point value at that moment.
- A coupon's value and point cost derive from its selected **coupon type** at issuance and are
  snapshotted (fixed) on the coupon thereafter.
- Money-coupon redemption reduces the customer's receivable (what they owe); the balanced counter-leg is
  `loyalty_expense` (a marketing cost), consistent with the ledger-derived balances rule.
- Reused entities (customer accounts, ledger, products, stock, sales invoices) behave exactly as defined
  in 001/002 and are not redefined here.
- **No expiry (resolved Q1)**: coupons and accumulated points never expire; they persist until
  redeemed/converted (or voided per Q3). No expiry-date field exists.
- **Whole-coupon conversion (resolved Q2)**: points convert only in whole-coupon increments at the
  configured rate; a request below one full coupon's rate is rejected, and any sub-coupon remainder
  stays as the point balance.
- **Return after consumption (resolved Q3)**: a return is never blocked. If reversed points were already
  consumed, an unredeemed resulting coupon is voided to reclaim points; an already-redeemed one records a
  negative point adjustment (balance may go negative), settled against future earnings — all as new
  linked records (Principle IV). **Test/impl note**: this requires test-first coverage (Principle X) for
  the void path, the negative-adjustment path, and the never-blocked guarantee, alongside coupon-serial
  uniqueness and reversal symmetry.

## Out of Scope *(deferred to their own specs)*

- Offline sync mechanics (rep mobile loyalty actions) — separate spec.
- Employees, salaries, advances.
- Multi-currency, VAT/tax.
- Customer-to-customer point transfer (explicitly removed in constitution v1.3.0).
