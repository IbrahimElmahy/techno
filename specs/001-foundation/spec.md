# Feature Specification: Foundation (Shared Base)

**Feature Branch**: `001-foundation`
**Created**: 2026-06-25
**Status**: Draft
**Input**: User description: "Specify the Foundation feature for the unified business management system — the shared base (Users & Auth, RBAC, Organization, Warehouses, Customers, Treasury ledger) that Sales & Inventory, After-Sales, and Treasury build on. Follow the project constitution (v1.1.0)."

## Clarifications

### Session 2026-06-25

- Q: What is the Sales Manager's data scope and authority? → A: Branch-scoped — view/manage
  sales data, customers, and sales reports within their own branch only; no org/user/warehouse/
  treasury administration.
- Q: What do users log in with? → A: An admin-assigned unique username / login-ID plus password.
- Q: How is a customer uniquely identified? → A: A system-generated customer code is the stable
  identity; phone is captured and duplicate phones are flagged/warned but allowed.
- Q: What is the audit-trail scope at the foundation level? → A: Audit write/security actions —
  logins, role/permission changes, customer reassignment, activations/deactivations, and ledger
  postings/reversals (actor + timestamp + before/after); reads are not logged.
- Q: How are custodies (عهدة) structured per holder? → A: One custody per holder (rep/warehouse);
  both cash and goods positions are tracked via the ledger under that single custody.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - System Admin establishes the organization (Priority: P1)

A System Admin signs in and sets up the company backbone: the head office and branches
(each in an Egyptian governorate), the warehouses attached to each branch and the central
warehouse, the user accounts and their roles, and the company-wide treasury. This is the
seed from which every other domain operates.

**Why this priority**: Nothing else can exist without an organization, users, roles, and the
treasury ledger. This is the irreducible MVP — without it there is no system to log into.

**Independent Test**: Create a head office, two branches, their warehouses, and at least one
user per role; confirm the System Admin can see and manage all of them across all branches,
and that the consolidated treasury exists with a zero, ledger-derived balance.

**Acceptance Scenarios**:

1. **Given** a fresh system with a System Admin account, **When** the admin creates a head
   office and two branches each tied to a governorate, **Then** both branches are persisted
   and visible to the admin.
2. **Given** an existing branch, **When** the admin attaches a branch warehouse and a central
   warehouse, **Then** both warehouses exist, share the one product catalog reference, and
   track stock independently (catalog/stock detail is out of scope here).
3. **Given** the organization exists, **When** the admin creates users and assigns each a role,
   **Then** each user can authenticate and is granted exactly the permissions of that role.
4. **Given** the company is created, **When** the admin opens the treasury, **Then** a single
   consolidated double-entry treasury exists and its balance is computed from the ledger.

---

### User Story 2 - Branch Manager / Purchasing Manager operates within one branch (Priority: P2)

A Branch Manager (or Purchasing Manager) signs in and has full access to their own branch —
its people, warehouses, customers, and treasury custodies — but cannot see or change any other
branch's data.

**Why this priority**: Branch isolation is the core security guarantee of the shared permission
model; it must hold before any branch-level operational domain is built on top.

**Independent Test**: With two branches each having data, sign in as Branch A's manager and
confirm full read/write on Branch A and zero visibility (read and write denied) on Branch B.

**Acceptance Scenarios**:

1. **Given** a Branch Manager for Branch A, **When** they list warehouses, users, or customers,
   **Then** only Branch A's records are returned.
2. **Given** a Branch Manager for Branch A, **When** they attempt to read or modify a Branch B
   record by direct request, **Then** the request is denied server-side regardless of the UI.
3. **Given** a Purchasing Manager, **When** they access branch data, **Then** they have the same
   branch-scoped full access as the Branch Manager.

---

### User Story 3 - After-Sales Staff manages customers and their accounts (Priority: P2)

After-Sales Staff sign in and manage the central customer records: customer type, the assigned
rep and territory (formerly region), and each customer's running account (Receivables / ذمم) whose
balance is derived from the ledger and supports both credit (آجل) and cash settlement.

**Why this priority**: Customers and their receivable accounts are referenced by every later
revenue and loyalty flow; the records and their ledger linkage must exist first.

**Independent Test**: Create a customer of type "trader", assign a rep and territory, and confirm a
customer account exists with a ledger-derived balance of zero and the ability to record credit
and cash entries against it (entry posting mechanics validated at ledger level).

**Acceptance Scenarios**:

1. **Given** After-Sales Staff, **When** they create a customer, **Then** the customer has a type
   (trader, plumber, or other), an assigned rep, an assigned territory, and a linked account.
2. **Given** an existing customer, **When** their account is inspected, **Then** the balance is
   computed from posted ledger entries, not stored as a standalone editable number.
3. **Given** a customer, **When** the schema is examined, **Then** the customer's stable code is
   present as the identity loyalty will later attach to, and **no** loyalty balance/transfer schema
   exists in Foundation (loyalty is owned by the After-Sales spec).
4. **Given** a customer owned by Rep A with an existing account balance and prior invoices, **When**
   an authorized user reassigns the customer to Rep B, **Then** the customer keeps the same account
   identity and balance, future ownership moves to Rep B, and the prior invoices remain attributed
   to Rep A.

---

### User Story 4 - Sales Rep signs in on mobile and sees only their own data (Priority: P2)

A Sales Rep authenticates from the mobile app and is scoped to only their own customers,
their own custody (عهدة) location, and their own records. They have no web/back-office access.

**Why this priority**: The rep scoping rule is a hard security boundary that the offline-first
mobile domain depends on; it must be enforced at the foundation level.

**Independent Test**: Sign in as a rep and confirm only that rep's assigned customers and custody
are visible, and that any request for another rep's or another branch's data is denied.

**Acceptance Scenarios**:

1. **Given** a Sales Rep account, **When** the rep authenticates, **Then** a secure session is
   established and only mobile-scoped capabilities are available.
2. **Given** a Sales Rep, **When** they request customer or custody data, **Then** only records
   assigned to that rep are returned and all others are denied server-side.
3. **Given** a Sales Rep, **When** they attempt any back-office/web-only action, **Then** it is
   denied by role.

---

### User Story 5 - Sales Manager has sales-scoped visibility (Priority: P3)

A Sales Manager signs in and can view and manage sales data, customers, and sales reports within
their own branch only, without the org/user/warehouse/treasury administration powers of a Branch
Manager.

**Why this priority**: Needed for the role model to be complete, but no operational sales domain
exists yet at the foundation layer, so it is lower priority than the security boundaries above.

**Independent Test**: Sign in as a Sales Manager and confirm the permitted sales-scoped reads and
the denial of administration actions reserved to Branch Manager / System Admin.

**Acceptance Scenarios**:

1. **Given** a Sales Manager for Branch A, **When** they access sales data, customers, or sales
   reports, **Then** only Branch A's records are returned and another branch's data is denied.
2. **Given** a Sales Manager, **When** they attempt an org/user/warehouse/treasury administration
   action, **Then** it is denied server-side.

---

### Edge Cases

- What happens when a user with no role (or a deactivated account) attempts to authenticate? The
  system MUST deny access and establish no session.
- What happens when a branch-scoped user's branch assignment is removed while they hold a session?
  Subsequent requests MUST re-evaluate scope and deny out-of-scope access.
- What happens when an admin attempts to delete a branch, warehouse, or customer that is referenced
  by ledger entries? The reference MUST be preserved (no destructive delete that orphans ledger
  history); deactivation is used instead.
- What happens when a ledger entry must be corrected? A linked mirror reversal entry MUST be
  created; the original entry is never edited or deleted (constitution Principle IV).
- What happens when two warehouses hold the same product? Each tracks its own quantity
  independently; no operation may draw from another warehouse's stock (detail deferred to Sales).
- Custody (عهدة) holder reassignment is **out of scope for Foundation** (accepted gap): custodies
  are created per holder and are not reassigned in this feature; it will be addressed if/when a
  later feature requires it.

## Requirements *(mandatory)*

### Functional Requirements

#### Users & Authentication

- **FR-001**: System MUST support user accounts that authenticate with an admin-assigned unique
  username / login-ID plus a password, and establish a secure, expiring session. The username /
  login-ID MUST be unique across the system and serves as the account's stable identifier.
- **FR-002**: System MUST enforce all access decisions server-side; client/UI checks are never
  sufficient on their own.
- **FR-003**: System MUST allow user accounts to be deactivated, after which authentication and
  all access are denied while historical references to the user are preserved.
- **FR-004**: System MUST associate every authenticated request with the acting user's role and
  scope for authorization.

#### Roles & Permissions (RBAC)

- **FR-005**: System MUST implement the constitution roles: System Admin, Branch Manager,
  Purchasing Manager, Sales Manager, After-Sales Staff, and Sales Rep.
- **FR-006**: System Admin MUST have access to all branches and all data.
- **FR-007**: Branch Manager and Purchasing Manager MUST have full access limited to their own
  branch, and MUST be denied read and write on any other branch's data.
- **FR-008**: After-Sales Staff MUST be able to manage customers, customer accounts, and (in later
  domains) points and coupons, within their permitted scope.
- **FR-008a**: Sales Manager MUST be branch-scoped: able to view and manage sales data, customers,
  and sales reports within their own branch only, and MUST be denied org, user, warehouse, and
  treasury administration as well as any other branch's data.
- **FR-009**: Sales Rep MUST be restricted to mobile access and to only their own stock, customers,
  custody, and records; all other data MUST be denied.
- **FR-010**: The server MUST enforce permission capabilities on every endpoint as the sole
  authority. Per-screen exposure is a client obligation layered on top and is never a substitute
  for server enforcement.
- **FR-011**: System MUST deny by default: any capability not explicitly granted to a role is
  forbidden.

#### Organization Structure

- **FR-012**: System MUST represent one head office and zero or more branches, each branch located
  in an Egyptian governorate.
- **FR-013**: System MUST allow people (users) and warehouses to be attached to a branch.
- **FR-014**: System MUST represent territories such that each territory is wholly contained within
  exactly one branch, and each Sales Rep belongs to exactly one branch and exactly one territory.

#### Warehouses & Stock-Holding Locations

- **FR-015**: System MUST represent stock-holding locations of three kinds: the central warehouse,
  branch warehouses, and per-rep custody (عهدة) locations.
- **FR-016**: All warehouses MUST reference one shared product catalog, while stock quantities are
  tracked independently per location (catalog and stock-movement detail is out of scope here).
- **FR-017**: Each warehouse/custody location MUST have a defined owner/holder (branch, or the rep
  for a custody) for accountability.

#### Customers

- **FR-018**: System MUST maintain a central customer table shared across the organization.
- **FR-018a**: Each customer MUST have a system-generated unique customer code that serves as the
  stable identity. Phone numbers MUST be captured but are not enforced unique; the system MUST flag
  a likely-duplicate when a phone matches an existing customer, while still allowing the record.
- **FR-019**: Each customer MUST have a type of trader, plumber, or other.
- **FR-020**: Each customer MUST be owned, at any point in time, by exactly one rep and exactly
  one territory.
- **FR-020a**: System MUST allow an authorized user to reassign a customer from one rep to another
  (and to the new rep's territory), subject to all of the following guarantees:
  - The customer remains one single account with a stable identity; reassignment MUST NOT
    duplicate, split, or reset the customer or their account/balance.
  - Historical transactions MUST remain permanently attributed to the rep who performed them
    (history is immutable, per constitution Principle IV); only future ownership and new
    transactions move to the new rep.
  - The customer's account balance and receivables (ذمم) MUST be unaffected by reassignment —
    same account, same balance, continuous.
  - Reassignment MUST be permitted only to System Admin and Branch Manager / Purchasing Manager.
- **FR-021**: Each customer MUST have a running customer account (Receivables / ذمم) whose balance
  is derived from posted ledger entries and supports both credit (آجل) and cash settlement.
- **FR-022**: Loyalty-point balance and point-transfer mechanics are **owned by the After-Sales
  spec** and MUST NOT be modeled in Foundation. Foundation only guarantees the customer's stable
  identity (the system-generated customer code, FR-018a) that loyalty will later attach to. No
  loyalty column or table is added by this feature.
- **FR-023**: Customers referenced by ledger entries MUST NOT be hard-deleted; deactivation MUST be
  used to preserve history.

#### Treasury Foundation

- **FR-024**: System MUST maintain one company-wide consolidated treasury using double-entry
  accounting in which every movement is a balanced debit/credit.
- **FR-025**: System MUST support exactly one sub-custody (عهدة) per holder — one per rep and one
  per warehouse — and each custody's cash and goods positions MUST both be tracked via the ledger
  under that single custody and reconcile back to the consolidated treasury.
- **FR-026**: System MUST provide a shared ledger/journal entity that all domains post to; treasury,
  custody, and customer-account balances MUST all be derivable from it and not stored standalone.
- **FR-027**: System MUST support reversal linkage: every ledger entry can have a linked mirror
  reversal entry, and corrections MUST be made by posting a reversal rather than editing or
  deleting the original. An entry MAY be reversed **at most once**, and a reversal entry is itself
  **not** re-reversible.
- **FR-028**: Posted ledger entries MUST be immutable; only reversal entries may offset them.

#### Cross-Cutting

- **FR-029**: Arabic right-to-left (RTL) presentation is a client/UI obligation and applies to
  client-facing features. The backend (this feature) MUST enforce the single currency (Egyptian
  Pound) and MUST return locale-neutral error/message codes (not localized strings).
- **FR-030**: System MUST keep an attributable record of who created or reversed each ledger entry.
- **FR-031**: System MUST maintain an audit trail of write and security-sensitive actions —
  successful and failed logins, role/permission changes, customer reassignment, account
  activations/deactivations, and ledger postings/reversals — recording the actor, timestamp, and
  before/after state. Read access is not logged.

### Key Entities *(include if feature involves data)*

- **User**: An account that authenticates and acts; identified by a system-unique, admin-assigned
  username / login-ID (its stable identifier); has a role and (for scoped roles) a branch and/or rep
  identity; can be active or deactivated.
- **Role**: One of the six constitution roles; defines the permission set and scope boundary.
- **Head Office / Branch**: The organizational unit; a branch is located in an Egyptian governorate
  and owns people and warehouses.
- **Territory**: A geographic grouping wholly contained within exactly one branch; each Sales Rep
  belongs to exactly one branch and one territory, and customers are assigned to a territory.
- **Warehouse / Stock-Holding Location**: Central warehouse, branch warehouse, or per-rep custody;
  references the shared catalog; tracks stock independently; has an owner/holder.
- **Customer**: A central record identified by a system-generated unique customer code (its stable
  identity), with a captured phone (not enforced unique; duplicates flagged) and a type
  (trader/plumber/other); owned at
  any time by exactly one rep and one territory, with that ownership reassignable by an authorized
  user without affecting the account/balance or the attribution of past transactions; has a linked
  customer account. Loyalty-point balance and transfer are owned by the After-Sales spec and are not
  part of the Foundation customer schema.
- **Customer Account (Receivables / ذمم)**: A running account per customer; balance derived from
  the ledger; supports credit and cash.
- **Treasury**: The single consolidated double-entry treasury; balance derived from the ledger.
- **Custody (عهدة)**: Exactly one sub-account per holder (rep or warehouse); tracks both cash and
  goods positions via the ledger and reconciles to the treasury.
- **Ledger / Journal Entry**: The immutable shared posting record (debit/credit) all domains write
  to; carries author attribution and an optional linked reversal entry.
- **Audit Log Entry**: A record of a write or security-sensitive action (login, role/permission
  change, customer reassignment, activation/deactivation, ledger posting/reversal) capturing actor,
  timestamp, and before/after state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A System Admin can stand up a head office, 2 branches, their warehouses, one user per
  role, and the consolidated treasury, end to end, in a single session.
- **SC-002**: 100% of cross-branch access attempts by a branch-scoped user are denied (read and
  write), verified across every foundation entity type.
- **SC-003**: 100% of a Sales Rep's requests for data not assigned to them are denied, and the rep
  has no back-office access.
- **SC-004**: Every treasury, custody, and customer-account balance shown equals the sum of its
  posted ledger entries (no standalone stored balance disagrees with the ledger) in 100% of checks.
- **SC-005**: Every correction to a posted ledger entry is achieved via a linked reversal; zero
  posted entries are edited or deleted.
- **SC-006**: 100% of permission checks are enforced server-side, demonstrated by denials persisting
  when the request bypasses the UI.
- **SC-007**: 100% of audited actions (logins, role/permission changes, customer reassignment,
  activations/deactivations, ledger postings/reversals) produce an audit record with actor,
  timestamp, and before/after state.

## Assumptions

- A user holds exactly one role at a time (no multi-role accounts in the foundation layer).
- Branch-scoped roles (Branch Manager, Purchasing Manager) are each tied to exactly one branch.
- Each territory is wholly contained within exactly one branch; a Sales Rep belongs to exactly one
  branch and exactly one territory.
- A customer is owned, at any point in time, by exactly one rep and one territory; this ownership is
  reassignable by an authorized user (System Admin or Branch Manager / Purchasing Manager) without
  duplicating, splitting, or resetting the customer, their account, or their balance, and with past
  transactions remaining attributed to the original rep.
- Loyalty-point balance, point-transfer mechanics, and all loyalty schema are owned by and deferred
  to the After-Sales spec; Foundation adds no loyalty columns or tables.
- Product catalog content, stock quantities, and stock movements are defined in the Sales &
  Inventory spec; this feature defines only the location/ownership entities.
- Authentication uses a standard secure session model; specific credential/MFA policy is deferred to
  implementation planning unless mandated later.
- Currency is Egyptian Pound only and the UI is Arabic RTL, per the constitution.

## Out of Scope *(explicit — deferred to their own specs)*

- Products and product catalog details
- Sales and purchase invoices
- Stock movements and transfers
- Loyalty points, point transfer, and coupon logic (entirely owned by the After-Sales spec; no
  loyalty schema in Foundation)
- Offline sync behavior
- Employees, salaries, and advances
