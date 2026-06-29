<!--
SYNC IMPACT REPORT
==================
Version change: 1.3.0 → 1.4.0
Bump rationale: MINOR — records the desktop front-end stack in Technology & Delivery Constraints.
No principle added, removed, or redefined; principles I–XI keep their numbers so all spec/plan
references stay valid.

Modified principles / sections:
  - Technology & Delivery Constraints — added the back-office **Desktop** front-end: an installed
    Windows app (Electron + React, Arabic RTL, AntiGravity + Gemini 3 Pro) used by all roles except
    Sales Rep; a thin CLIENT of the OpenAPI contract (Principle II) with NO business logic — all
    rules/permissions/calculations stay server-authoritative (Principle VII). Mobile (Flutter,
    Sales Reps, offline-first) unchanged.

Prior amendment (1.2.0 → 1.3.0, MINOR):
  - Domain Scope & Phasing (item 1) — removed the customer-to-customer loyalty-point transfer
    (now out of scope; each customer earns/holds their own points independently).
  - Domain Scope & Phasing (item 2) — expanded with the confirmed After-Sales model: per-product
    editable point values; earn-per-product at invoice time (cash or credit); sales return
    reverses earned points (Principle IV); manual points→coupons at a settings rate; coupons have
    a unique serial + type (money | gift); money coupon redeems against receivable, posting the
    value to a new `loyalty_expense` ledger account type (additive — not a new ledger); gift
    coupon redeems as product (decrements stock, Principle XI) or money off an invoice; redemption
    on a customer's invoice or standalone. Resolved the prior earn/redeem [NEEDS CLARIFICATION].

Prior amendment (1.1.2 → 1.2.0, MINOR):
  - Added Principle XI. No Negative Stock; expanded Domain Scope item 1 with the item/
    manufacturing model (two item kinds, decoupled BOM-free manufacturing).
Added sections: None (existing sections expanded)
Removed sections: None

Prior amendment (1.1.1 → 1.1.2, PATCH):
  - Domain Scope & Phasing (items 1 & 2) — loyalty-point balance, point-transfer mechanics, and
    all related schema are now explicitly OWNED BY and DEFERRED TO the After-Sales spec; the
    Foundation feature MUST NOT add loyalty columns/tables. The customer model carries only a
    stable identity sufficient for loyalty to attach to later. Deferral is now the intended
    design, not a gap.

Prior amendment (1.1.0 → 1.1.1, PATCH):
  - Technology & Delivery Constraints — resolved backend [NEEDS CLARIFICATION]: backend runtime
    stack set to Python + FastAPI + SQLAlchemy + MySQL/MariaDB; API contract is OpenAPI
    (FastAPI-generated) per Principle II.

Prior amendment (1.0.0 → 1.1.0, MINOR):
  - III. Offline-First Mobile — resolved conflict-resolution clarification
    (server-authoritative; fresh pull on new device/reinstall; no dual-device offline stock).
  - VI. Treasury Model — expanded to cover Customer Accounts (Receivables / ذمم) and
    customer-account postings (credit purchase, payment, coupon redemption).
  - Domain Scope & Phasing — added customer model attributes (type, point transfer);
    expanded After-Sales note (runtime Coupon Management settings, per-product point values).

Templates requiring updates:
  - .specify/templates/plan-template.md ............ ✅ no change needed
      (Constitution Check gate is derived from this file at plan time; no hardcoded
       principle names to update)
  - .specify/templates/spec-template.md ............ ✅ no change needed
  - .specify/templates/tasks-template.md ........... ✅ no change needed
  - .specify/templates/checklist-template.md ....... ✅ no change needed
  - .specify/templates/agent-file-template.md ...... ✅ no change needed

Deferred / follow-up TODOs (also marked [NEEDS CLARIFICATION] inline):
  - None outstanding for loyalty — the earn/redeem model is confirmed (v1.3.0). Detailed
    mechanics/UX still belong to the After-Sales spec, but no scope ambiguity remains.
  - RATIFICATION_DATE remains the greenfield first-adoption date; confirm if a formal
    sign-off date differs.
-->

# Unified Business Management System Constitution

A single internal system replacing the legacy A5 Group and Techno Light systems, covering
Sales & Inventory, After-Sales loyalty, and Accounting/Treasury under one shared
user/permission model.

## Core Principles

### I. Greenfield Only

No source code, scripts, or configuration is copied, ported, or adapted from the legacy
A5 Group or Techno Light systems. The new system is built from scratch. Legacy **data** is
migrated only at deployment time, table by table, after the corresponding feature is built
and tested — never imported up front to bootstrap development.

**Rationale**: Legacy code carries the structural debt this rebuild exists to eliminate;
copying it would reproduce the problems. Late, incremental data migration keeps the schema
clean and lets each table be validated against its new owner feature.

### II. Single Source of Truth (Shared API Contract)

A single versioned API contract is the authoritative interface between the backend and the
Flutter mobile app. Neither side may diverge from it: backend and app changes that affect
the contract MUST update the contract first, and both implementations MUST conform.
Contract changes are breaking-change-managed (see Governance versioning).

**Rationale**: Two independently built clients without a binding contract drift apart;
the contract is the one place where backend and app agree, so it must be authoritative.

### III. Offline-First Mobile

Sales Reps are the only mobile users. Offline, the app holds **only** that rep's own
inventory, customers, and invoices, and MUST support creating sales invoices that decrement
local stock. The app MUST NOT record cash or treasury entries offline — cash is recorded
server-side only when the rep physically hands money to the branch. Every record synced to
the server MUST be idempotent (safe to replay). Reps' inventories are isolated, so cross-rep
conflicts cannot occur by construction.

Conflict resolution is **server-authoritative**. On first login on a new device or after a
reinstall, the app pulls its dataset fresh from the server. A rep MUST NOT hold offline stock
on two devices simultaneously; the server is the single arbiter of a rep's offline dataset.

**Rationale**: Reps work in the field without reliable connectivity; the smallest correct
offline footprint (own stock + sales) avoids the hardest sync problems while still letting
reps sell. Excluding treasury offline keeps money movement server-authoritative.

### IV. Reversibility of All Transactions

Every financial or stock-affecting operation MUST have a defined mirror reversal, and the
data model MUST enforce this symmetry: sale ↔ return, inbound ↔ return-inbound,
stock-transfer ↔ reverse-transfer, treasury debit ↔ credit. Reversals are recorded as new
linked entries, never by deleting or mutating the original.

**Rationale**: Auditable, append-only correction is mandatory for financial integrity and
inventory truth; destructive edits destroy the audit trail.

### V. Multi-Branch & Multi-Warehouse

The organization is one head office plus branches across Egyptian governorates. One central
warehouse supplies branch warehouses and reps. All warehouses share **one** product catalog
but track stock **independently**. A sale decrements only the stock of the originating
warehouse; no operation may implicitly draw stock from another warehouse.

**Rationale**: Shared catalog with independent stock ledgers is the only model that keeps
product definitions consistent while keeping each location's inventory accountable.

### VI. Treasury & Customer Accounts (Double-Entry + Custodies + Receivables)

The system maintains one company-wide consolidated treasury using double-entry accounting
(every movement is a balanced debit/credit). In addition, sub-custodies (عهدة) exist per rep
and per warehouse, each holding cash or goods and reconcilable back to the central treasury.

Every customer has a running account (Receivables / ذمم) supporting credit terms (آجل): a
customer MAY buy on credit and settle later, or pay cash. Customer-account movements —
purchase on credit, payment, and coupon redemption — post to this account, which links
customers ↔ treasury ↔ invoices.

All balances (treasury, custody, and customer account) MUST always be derivable from the
ledger, not stored as the sole source of truth.

**Rationale**: Double-entry guarantees the books balance; per-rep/per-warehouse custodies
make field cash and stock accountable to a named holder; ledger-derived customer accounts
make credit exposure auditable and always consistent with invoices and payments.

### VII. Role-Based Access Control

Access is governed by a shared role model. Roles and their boundaries:

- **System Admin** — all branches, all data.
- **Branch Manager / Purchasing Manager** — full access to their own branch only.
- **Sales Manager** — sales operations within scope.
- **After-Sales Staff** — points, coupons, and customer invoices.
- **Sales Rep** — mobile only; sees only their own stock, customers, and invoices.

Every endpoint and screen MUST enforce these boundaries server-side; client-side checks are
never sufficient. Branch-scoped roles MUST NOT read or write other branches' data.

**Rationale**: A single shared permission model across all three domains prevents
inconsistent ad-hoc access rules and enforces least privilege.

### VIII. Arabic RTL Localization, EGP Only

The UI is Arabic and right-to-left (RTL) by default. The system uses a single currency, the
Egyptian Pound (EGP); no multi-currency support is in scope. Amounts, dates, and numbers
MUST render correctly under Arabic/RTL conventions.

**Rationale**: A single locale and currency removes whole classes of formatting,
rounding, and exchange-rate complexity for an internal Egyptian operation.

### IX. Reporting Is First-Class

Reporting is a primary feature, not an afterthought. All report types — daily, managerial,
revenue, and purchases — MUST support filtering by customer, region, date, supplier, and
rep. Report data MUST be derived from the same authoritative ledgers as operations, so
reports and live state never disagree.

**Rationale**: The business runs on these reports; building them on the operational source
of truth guarantees they are correct rather than reconciled after the fact.

### X. Test-First for Critical Logic (NON-NEGOTIABLE)

For sync, stock-movement, treasury, and coupon-serial logic, tests MUST be written and MUST
fail before implementation begins (Red-Green-Refactor). These four areas have no exception:
no implementation merges without preceding tests covering its correctness and its reversal
or idempotency behavior. Other areas SHOULD follow the same discipline.

**Rationale**: These four domains are where silent errors corrupt money and inventory;
test-first is the cheapest guarantee that reversals, idempotency, and serials are correct.

### XI. No Negative Stock

The stock quantity of any item at any location MUST never go below zero. Any sale, consumption,
or transfer that would reduce stock below the available quantity MUST be rejected — never
recorded as a deficit or negative balance. This invariant holds especially in the offline
mobile flow, where a Sales Rep sells from locally-held stock and the local quantity is the
binding limit until sync. (Stock-movement correctness is verified test-first under Principle X.)

**Rationale**: Negative stock is always a data error masking a real-world impossibility; an
honest, rejected operation is recoverable, a silent deficit corrupts every downstream count and
valuation.

## Domain Scope & Phasing

The system covers three domains under one shared user/permission model:

1. **Sales & Inventory** — in scope. The customer model MUST include a customer **type**
   (e.g., trader, plumber, other) and MUST carry a **stable identity** sufficient for loyalty to
   attach to later. The loyalty-point balance and all related schema are **owned by and deferred
   to the After-Sales spec** (see item 2); the Foundation feature MUST NOT add loyalty columns or
   tables. Each customer earns and holds their **own** points independently; there is **no**
   customer-to-customer point transfer (out of scope).

   The catalog contains exactly two item kinds:
   - **Raw materials** — purchased from suppliers, have a purchase price, are consumed, and are
     never sold.
   - **Products** — manufactured in-house, have a fixed sale price, and are sold.

   Manufacturing is **simple and decoupled**: consuming raw material and producing/adding a
   product are two **independent** stock operations — not a single tied transaction and not
   driven by a fixed recipe/BOM. Both item kinds MAY be stored in any warehouse/location.
   Detailed mechanics belong to the Sales & Inventory spec.
2. **After-Sales loyalty (points & coupons)** — in scope, and the **sole owner** of all loyalty
   schema and behavior. The confirmed model:
   - **Point values**: each product carries an **editable point value** set per product by
     After-Sales Staff.
   - **Earning**: a customer earns points **per purchased product at invoice time**, regardless of
     whether the sale is cash or credit. A **sales return reverses** the points it earned
     (Principle IV).
   - **Points → coupons**: conversion is **manual** by After-Sales Staff at a settings-configured
     rate; it is not automatic.
   - **Coupons**: each coupon has a **unique serial/ID** and a **type** — **money** or **gift**.
     - A **money** coupon redeems against the customer's **receivable account**, with the coupon
       value posted as a loyalty/marketing expense to a new **`loyalty_expense`** ledger
       account type (additive to the existing ledger — **not** a new ledger).
     - A **gift** coupon redeems as either a **product** (decrements stock, subject to
       No-Negative-Stock, Principle XI) or **money off an invoice**.
   - **Redemption** may occur on a customer's **sales invoice** or as a **standalone** invoice.
   - **Runtime settings**: coupon price, points-to-coupon rate, and coupon types are managed at
     runtime by After-Sales Staff (a "Coupon Management" screen) and MUST NOT be hardcoded.
   Detailed mechanics/UX belong to the After-Sales spec; this section fixes the scope and rules.
3. **Accounting/Treasury & Employees** — Treasury is in scope (see Principle VI). The
   **Employees** sub-domain (employees, salaries, advances) is explicitly **deferred to a
   final later phase** and MUST NOT be built before the prior domains are delivered.

Deferred work MUST NOT introduce schema or API commitments that constrain its later design
beyond what the active domains genuinely require.

## Technology & Delivery Constraints

- **Backend**: developed with Claude Code + GLM 4.7. Runtime stack is Python with FastAPI,
  SQLAlchemy as the ORM, and MySQL/MariaDB as the datastore.
- **Desktop (back office)**: an installed **Windows desktop app** built with **Electron + React**,
  Arabic right-to-left, used by all roles **except Sales Rep** (System Admin, Branch Manager,
  Purchasing Manager, Sales Manager, After-Sales Staff). It is a **thin CLIENT** that consumes the
  backend OpenAPI contract (Principle II) over the internal network and contains **NO business logic
  of its own** — all rules, permissions, and calculations remain server-authoritative (Principle VII:
  client-side checks are never sufficient). Developed with AntiGravity + Gemini 3 Pro.
- **Mobile**: Flutter app (for Sales Reps, offline-first) developed with AntiGravity + Gemini 3 Pro.
- **Contract**: backend, desktop, and mobile clients are bound by the shared API contract
  (Principle II); the contract is expressed as OpenAPI (auto-generated by FastAPI), versioned, and
  lives in the repository.
- **Data migration**: performed at deployment, table by table, per Principle I.
- **Tooling choices** above are delivery constraints, not architecture; architectural
  decisions are recorded per-feature in plan.md under the Constitution Check gate.

## Governance

This constitution supersedes other practices and conventions where they conflict. All
feature plans, specs, and task lists MUST be checked against these principles; the
Constitution Check gate in the plan template enforces this before design and after design.

**Amendments**: Any change to a principle or section requires a written rationale, review
and approval by the project owner, and a documented migration/impact note for affected
features. Approved amendments update this file and bump the version below.

**Versioning policy** (semantic):

- **MAJOR** — backward-incompatible removal or redefinition of a principle or governance rule.
- **MINOR** — a new principle/section is added or existing guidance is materially expanded.
- **PATCH** — clarifications, wording, or typo fixes with no change in obligations.

**Compliance review**: Plans that violate a principle MUST either be revised or record the
violation, its justification, and the rejected simpler alternative in the plan's Complexity
Tracking table. Unjustified violations block the plan. Items marked [NEEDS CLARIFICATION]
MUST be resolved before the dependent feature is implemented.

**Version**: 1.4.0 | **Ratified**: 2026-06-25 | **Last Amended**: 2026-06-28
