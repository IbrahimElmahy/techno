# Feature Specification: Cost Centers (Analytical Dimension)

**Feature Branch**: `006-cost-centers-optional`
**Created**: 2026-06-29
**Status**: Draft
**Input**: Replicate A5Group's **مراكز التكلفة** (S03): a cost-center master plus an **optional**
cost-center dimension on ledger lines (and the documents that post them), so accounting can be analysed
by cost center — without changing how money is recorded. Builds additively on the General Ledger (005).

## Context & Dependencies

This feature builds on **General Ledger (005)** and **Foundation (001)** and reuses — never redefines —
their primitives:

- The **one immutable ledger** (`ledger_entry` / `ledger_line`); cost center is an **attribute on a
  line**, not a new ledger or a second balance store (Principle VI). The 005 data model explicitly left
  room for this: "journal lines are designed to allow adding a cost-center reference without rework."
- The **chart of accounts**, **manual journal entries**, **trial balance** (005) — a cost center is a
  *second axis* alongside the account; it never replaces the account.
- **RBAC** (deny-by-default), **branches**, **audit log** (001).

A cost center answers "**which activity / project / department** did this money belong to?" independently
of "which account". It is **optional** everywhere: existing 001/002/003 postings and any journal line may
leave it blank, and nothing about balancing or immutability changes.

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accountant maintains the cost-center master (Priority: P1)

An authorized user defines the **cost centers** — a coded, named, optionally hierarchical list
(e.g. `الفرع الرئيسي`, `معرض مدينة نصر`, `مشروع التوسعة`) — that may later be attached to journal lines.

**Why this priority**: Nothing can be tagged before the list exists; it is the master data the dimension
draws from (the A5Group S03 master).

**Independent Test**: Create a parent cost center and a child; confirm the hierarchy nests, codes are
unique, and a cost center can be deactivated (not hard-deleted) once it has been used.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they create a cost center with a unique code and name, **Then**
   it is available to tag journal lines.
2. **Given** a cost center, **When** a child is created under it, **Then** the child nests under the
   parent (unbounded depth), mirroring the chart's grouping.
3. **Given** a cost center that has tagged ledger lines, **When** deletion is attempted, **Then** it is
   rejected; the cost center is **deactivated** instead (history preserved, Principle IV).
4. **Given** a deactivated cost center, **When** posting a new journal line, **Then** it cannot be chosen
   (but historical lines keep their tag).

---

### User Story 2 - Accountant tags journal lines with a cost center (Priority: P1)

When posting a manual journal entry, an authorized user may attach a cost center to **each line**
(optional per line). The tag is stored on the ledger line; balancing and immutability are unaffected.

**Why this priority**: Tagging at posting time is the whole point of the dimension — it's how analytical
data is captured (A5Group asks the cost center on the document).

**Independent Test**: Post a balanced journal entry where one line carries a cost center and another does
not; confirm both post, the tag is stored on the first line only, and the entry still balances.

**Acceptance Scenarios**:

1. **Given** active cost centers, **When** a journal line is posted with a `cost_center_id`, **Then** the
   line stores that tag and the entry posts unchanged otherwise.
2. **Given** a journal line with **no** cost center, **When** it is posted, **Then** it posts normally
   (the dimension is optional).
3. **Given** a journal line referencing a **deactivated or unknown** cost center, **When** posted, **Then**
   it is rejected with a clear message.
4. **Given** a posted line with a cost center, **When** the entry is **reversed**, **Then** the reversing
   line carries the **same** cost center (the reversal nets out in the same cost center).

---

### User Story 3 - Accountant analyses the ledger by cost center (Priority: P2)

An authorized user filters the **trial balance** (and the journal list) by a cost center, to see the
debit/credit/closing **for that cost center only** — derived from the same ledger lines.

**Why this priority**: The dimension is only valuable if it can be read back; but it depends on US1/US2
existing first, and the broader reporting layer is a later feature.

**Independent Test**: Post lines under two cost centers, then request the trial balance filtered by one;
confirm only that cost center's movement is included and the grand totals still balance within it.

**Acceptance Scenarios**:

1. **Given** lines tagged with different cost centers, **When** the trial balance is requested with a
   `cost_center_id` filter, **Then** only lines carrying that cost center are aggregated.
2. **Given** the trial balance with a cost-center filter, **When** totals are computed, **Then** total
   debit = total credit when entries are fully tagged with that cost center (see Edge Cases / Assumptions).
3. **Given** no cost-center filter, **When** the trial balance is requested, **Then** all lines are
   included as today (no behavioural change to existing reports).

---

### Edge Cases

- A cost center MUST NOT be hard-deleted once it tags any ledger line; it is deactivated.
- Cost-center codes MUST be unique; a child's parent must be an existing cost center.
- A journal line referencing a deactivated/unknown cost center is rejected.
- A reversal copies the original line's cost center so the reversal nets within the same cost center.
- A trial balance filtered by a cost center may show **unequal** debit/credit totals if entries were only
  **partially** tagged (some lines tagged, others not) — this is expected; full balance per cost center is
  only guaranteed when every line of an entry shares the cost center (Assumptions).
- Opening-balance and 002/003 system postings carry **no** cost center (NULL) and are unaffected.

## Requirements *(mandatory)*

### Functional Requirements

#### Cost-Center Master

- **FR-001**: The system MUST provide a **cost-center master**: each cost center has a **unique code**, a
  **name**, an optional **parent** (unbounded-depth hierarchy), and an **active** flag.
- **FR-002**: A cost center with tagged ledger lines or active children MUST NOT be hard-deleted; it MUST
  be **deactivated** (history preserved, Principle IV).
- **FR-003**: Only an **active** cost center MAY be attached to a new ledger line; deactivated ones remain
  on historical lines but cannot be newly chosen.

#### Dimension on Ledger Lines

- **FR-004**: A ledger line MUST support an **optional** `cost_center_id`; balancing, immutability, and
  reverse-once are **unchanged** whether or not a line is tagged (Principle VI/IV).
- **FR-005**: A manual journal entry (005) MUST allow attaching a cost center **per line** (optional); a
  line referencing a deactivated/unknown cost center MUST be rejected.
- **FR-006**: A **reversal** of an entry MUST copy each original line's cost center onto its mirror line.
- **FR-007**: Existing 001/002/003 postings and opening balances MUST continue to post with a **NULL**
  cost center (no behavioural change, additive only).

#### Analysis

- **FR-008**: The **trial balance** (005) MUST accept an optional `cost_center_id` filter that restricts
  aggregation to lines carrying that cost center; with no filter, behaviour is unchanged.
- **FR-009**: The **journal list** MUST be filterable by cost center.

#### Access Control

- **FR-010**: Cost-center management and tagging MUST enforce Foundation RBAC server-side
  (deny-by-default). Managing the cost-center master and reading cost-center analysis use the **005
  accounting** capability set (Accountant + System Admin); no new role is introduced.

### Key Entities *(include if feature involves data)*

- **Cost Center**: An analytical dimension value — `id`, `code` (unique), `name`, `parent_id` (nullable,
  hierarchy), `active`. Master data; not a ledger account and not balance-bearing on its own.
- **Ledger Line (extended)**: The Foundation line gains an optional `cost_center_id` (nullable FK) — the
  tag. No other change.

*(Reused, not redefined: LedgerEntry, LedgerLine, Account, Branch, Role, Audit Log, the 005 journal /
trial-balance services.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can build a hierarchical cost-center master; 100% of attempts to hard-delete a used
  cost center are rejected (deactivated instead).
- **SC-002**: A journal line can be posted with or without a cost center; 100% of lines referencing a
  deactivated/unknown cost center are rejected, and tagging never changes whether an entry balances.
- **SC-003**: A reversal carries the same cost center as the original on every mirrored line in 100% of
  cases.
- **SC-004**: The trial balance filtered by a cost center aggregates only that cost center's lines in
  100% of checks; with no filter, output is the same as before this feature (no regression).
- **SC-005**: All 001/002/003 flows and the 005 trial balance continue to pass unchanged (no regression).

## Assumptions

- The cost center is an **optional second axis** on the existing ledger line — there is **no** separate
  cost-center ledger or stored balance; cost-center figures are **derived** by filtering lines
  (Principle VI/IX), exactly like account balances.
- **Per-cost-center balancing** is only guaranteed when every line of an entry shares one cost center.
  Partially-tagged entries are allowed (A5Group permits per-line cost centers); a filtered trial balance
  may therefore be unequal, which is surfaced (not an error).
- A **default cost center per custody/portfolio** ("تثبيت مركز التكلفة للحافظة") and cost centers on
  **sales/purchase documents** are **out of scope** here — this feature establishes the master + the
  ledger-line dimension + manual-journal tagging + analysis; document wiring comes when those documents
  are enhanced.
- No new role; reuses the 005 `accounting.*` capabilities.

## Out of Scope *(deferred to their own specs)*

- Cost centers on sales/purchase/stock documents (added when those documents are enhanced — T02/T04).
- Default cost center bound to a custody/rep ("تثبيت مركز التكلفة للحافظة").
- Cost-center P&L / dedicated cost-center reports (the Reporting layer, Phase 2).
- Budgets per cost center.
- Multi-currency, VAT (separate decisions).

## Clarifications

### Session 2026-06-29

- Q: Should cost centers be hierarchical or a flat list? → A: **Hierarchical** (unbounded depth),
  mirroring the chart of accounts and A5Group's grouping (FR-001).
- Q: Who manages cost centers and reads cost-center analysis? → A: **Reuse the 005 accounting
  capabilities** (Accountant + System Admin); no new role (FR-010).
- Q: Is the cost center required on journal lines? → A: **Optional per line**; partially-tagged entries
  are allowed (FR-004/005; Assumptions).
