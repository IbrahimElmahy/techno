# Feature Specification: Customer Credit Limit & Due-Term Enforcement

**Feature Branch**: `012-customer-credit-limit`
**Created**: 2026-07-02
**Status**: Draft
**Input**: Replicate A5Group's customer **credit limit** and **due-term** controls: a per-customer
**credit limit** (maximum outstanding receivable) and a **maximum due-term** (days a credit sale may
remain unpaid), **enforced at credit-sale time**. A credit sale that would push the customer's
outstanding receivable above the limit is blocked unless the actor holds an override capability; a
credit sale with a due-term beyond the customer's maximum is blocked. Builds additively on Sales &
Inventory (002).

## Context & Dependencies

Builds on **002** (customer, sales, ledger) and reuses — never redefines — its primitives:

- The **customer** master — gains `credit_limit` (money, nullable = unlimited) and `max_due_term_days`
  (int, nullable = no term cap). Advisory master data; enforcement happens only on credit sales.
- The **customer receivable** — outstanding balance is **derived from the ledger** (`balance_of` on the
  linked receivable account, Principle III); this feature adds **no** balance column and never mutates
  the ledger model.
- The **sales** flow — a credit sale (credit_amount > 0) is checked against the limit and term **before**
  posting; the existing stock-out + balanced ledger entry are unchanged. Cash-only sales are never
  blocked by this feature.
- **RBAC** — a new `sell.over_credit_limit` capability lets privileged roles override the limit (mirrors
  `sell.below_price`, 007). Deny-by-default (Principle X).

**Scope**: per-customer credit limit + max due-term; enforcement on credit sales; an optional `due_date`
stamped on credit invoices; a **credit-exposure / overdue report**. No aging buckets beyond overdue vs
current, no dunning workflow, no interest. The money/ledger model is unchanged.

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manager sets a customer credit limit and due-term (Priority: P1)

An authorized user sets a customer's **credit limit** (maximum outstanding receivable, EGP) and
**maximum due-term** (days). Both are optional; null means "no cap".

**Why this priority**: The limits are the master data every enforcement and report draws on.

**Independent Test**: Set credit_limit=5000, max_due_term_days=30 on a customer → they are stored and
returned on the customer card; clearing them (null) restores "unlimited".

**Acceptance Scenarios**:

1. **Given** a customer, **When** credit_limit / max_due_term_days are set, **Then** they are stored
   (money / integer) and returned on the customer record.
2. **Given** a customer with a limit, **When** it is cleared to null, **Then** the customer is treated as
   unlimited (no enforcement).

---

### User Story 2 - Block a credit sale over the limit (Priority: P1)

A credit sale that would push the customer's **outstanding receivable + this sale's credit portion**
above the credit limit is **blocked**, unless the actor holds `sell.over_credit_limit`.

**Why this priority**: This is the payoff — protecting the business from over-extending credit.

**Independent Test**: Customer with credit_limit=1000 and current receivable 800; a credit sale of 300 →
blocked (800+300 > 1000). A cash sale of 300 → allowed. With the override capability → allowed.

**Acceptance Scenarios**:

1. **Given** a customer with credit_limit L and outstanding receivable B, **When** a sale adds credit C
   and B + C > L, **Then** the sale is **rejected** (409) with a clear message — unless the actor holds
   `sell.over_credit_limit`, in which case it is **allowed**.
2. **Given** the same customer, **When** the sale is **cash-only** (credit portion 0), **Then** it is
   **never** blocked by the credit limit.
3. **Given** a customer with credit_limit null, **When** any credit sale is made, **Then** the limit is
   not enforced.
4. **Given** B + C == L exactly, **When** the sale is made, **Then** it is **allowed** (limit is a
   ceiling, reached is OK; only strictly above blocks).

---

### User Story 3 - Enforce the maximum due-term (Priority: P2)

A credit sale may carry a **due-term** (days until payment is due). If it exceeds the customer's
`max_due_term_days`, the sale is **blocked**. The resulting **due date** (sale date + term) is stamped on
the invoice for the overdue report.

**Why this priority**: Term control complements the amount limit; it depends on the same credit-sale hook.

**Independent Test**: Customer max_due_term_days=30; a credit sale with due_term_days=45 → blocked; with
30 → allowed and due_date = today + 30.

**Acceptance Scenarios**:

1. **Given** a customer with max_due_term_days=M, **When** a credit sale requests due_term_days D and
   D > M, **Then** the sale is **rejected**.
2. **Given** D ≤ M (or M null), **When** the credit sale is posted, **Then** `due_date` = sale date + D
   is stamped on the invoice.
3. **Given** a **cash-only** sale, **When** posted, **Then** no due_date is required or stamped.

---

### User Story 4 - Credit-exposure & overdue report (Priority: P2)

An authorized user sees each customer's **credit limit**, **outstanding receivable** (derived), **available
credit**, and whether they are **over limit**; and a list of **overdue** credit invoices (due_date < today
and the customer still carries an outstanding receivable).

**Why this priority**: Visibility into exposure is the reporting payoff; read-only, derived.

**Independent Test**: Two customers with limits and balances → the report shows exposure per customer and
flags the over-limit one; an invoice with due_date in the past appears in the overdue list.

**Acceptance Scenarios**:

1. **Given** customers with limits, **When** the credit-exposure report is requested, **Then** each row
   shows credit_limit, outstanding (derived), available (limit − outstanding), and an over_limit flag.
2. **Given** credit invoices with due dates, **When** the overdue report is requested, **Then** invoices
   with due_date < today are listed with their customer and the customer's outstanding amount.

---

### Edge Cases

- **Outstanding is derived, not stored** — always read via `balance_of` on the receivable account at
  enforcement time; concurrent sales are each checked against the balance at their own post time.
- **Override capability** bypasses only the **amount** limit, not the due-term cap (term is a hard policy).
- **Returns** reduce the receivable (002) and therefore restore available credit automatically — no extra
  logic here.
- **Limit reached exactly** is allowed; only strictly exceeding blocks.
- **Null limit / null term** = unlimited; enforcement is skipped.

## Requirements *(mandatory)*

- **FR-001**: The customer master MUST store an optional `credit_limit` (EGP money, ≥ 0) and optional
  `max_due_term_days` (integer, ≥ 0); null = no cap. Both settable on create and update.
- **FR-002**: On a **credit** sale (credit portion > 0) for a customer with a non-null credit_limit, the
  system MUST reject the sale when `outstanding_receivable + credit_portion > credit_limit`, unless the
  actor holds `sell.over_credit_limit`. Equality is allowed.
- **FR-003**: The credit-limit check MUST use the **derived** receivable balance (ledger), adding no
  stored balance and not mutating the ledger model.
- **FR-004**: A **cash-only** sale MUST never be blocked by the credit limit or due-term.
- **FR-005**: On a credit sale with a `due_term_days` for a customer with a non-null `max_due_term_days`,
  the system MUST reject when `due_term_days > max_due_term_days`.
- **FR-006**: A credit sale MUST stamp `due_date = sale_date + due_term_days` on the invoice when a term
  is provided; cash-only sales require no due_date.
- **FR-007**: A **credit-exposure report** MUST return, per customer with a limit, the limit, derived
  outstanding, available credit, and an over_limit flag.
- **FR-008**: An **overdue report** MUST list credit invoices whose `due_date < today` while the customer
  still carries an outstanding receivable.
- **FR-009**: The `sell.over_credit_limit` capability MUST be deny-by-default and granted only to the same
  privileged roles that may sell below price (system_admin, branch_manager, sales_manager), per RBAC.
- **FR-010**: All new endpoints/fields MUST be additive; migrations MUST NOT drop or redefine any 001–011
  table (Principle II).

### Key Entities

- **Customer** (extended): `credit_limit` (MONEY, nullable), `max_due_term_days` (INT, nullable).
- **SalesInvoice** (extended): `due_date` (DATE, nullable) — set for credit sales carrying a term.
- **Capability** `sell.over_credit_limit` — RBAC grant; no table.

## Success Criteria *(mandatory)*

- **SC-001**: Setting/clearing credit_limit and max_due_term_days round-trips on the customer record.
- **SC-002**: A credit sale that exceeds the limit is blocked; the same sale as cash, or under the limit,
  or by an override-capable actor, succeeds.
- **SC-003**: A credit sale beyond the max due-term is blocked; within it succeeds and stamps due_date.
- **SC-004**: The credit-exposure report's outstanding equals the ledger-derived receivable; over_limit is
  flagged correctly; the overdue report lists past-due unsettled invoices.
- **SC-005**: The full 001–011 test suite stays green; migrations are additive.
