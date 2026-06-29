# Feature Specification: General Ledger & Chart of Accounts

**Feature Branch**: `005-general-ledger`
**Created**: 2026-06-28
**Status**: Draft
**Input**: User goal: replicate A5Group's accounting core in our system — a hierarchical chart of
accounts (دليل الحسابات), manual journal entries (قيود اليومية), and a trial balance (ميزان المراجعة)
— built additively on the Foundation ledger (001), conforming to constitution v1.4.0.

## Context & Dependencies

This feature builds on **Foundation (001)** and reuses — never redefines — its primitives:

- **Immutable double-entry ledger** (`account` / `ledger_entry` / `ledger_line`) — the single money
  source of truth; all balances are **derived** from it (never stored standalone).
- **RBAC** (server-side, deny-by-default), **branches**, and the **audit log**.
- The existing **system accounts** created by 001/002/003 (treasury, custody, customer receivable,
  supplier payable, sales revenue, purchases/loyalty expense) — these become **postable leaf nodes**
  inside the new chart of accounts; they are **not** redefined.

This is the legacy A5Group accounting core (`acc`, `acc_main`, `accBrnch`, `mzan`) rebuilt cleanly:
a general ledger where the user defines their own chart of accounts and posts manual journal entries,
and a trial balance reads from the same ledger as every other operation (Principle IX).

All money is EGP; UI is Arabic/RTL (client concern). No VAT in this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Accountant builds the chart of accounts (Priority: P1)

An authorized accounting user defines a **hierarchical chart of accounts**: parent (group) nodes and
postable (leaf) accounts, each with a code and name, classified by nature (asset, liability, equity,
income, expense). The Foundation system accounts appear in the tree under their natural groups.

**Why this priority**: Nothing in general accounting can be posted or reported without a chart of
accounts; it is the structural backbone (the biggest gap vs A5Group).

**Independent Test**: Create an "Assets" group, a "Cash on hand" postable account under it, and a
sub-account beneath that; confirm the tree nests correctly, the system treasury account appears under
Assets, and a group (non-postable) node cannot receive a journal line.

**Acceptance Scenarios**:

1. **Given** an authorized user, **When** they create a parent (group) account and a child account,
   **Then** the child nests under the parent and the tree depth is unbounded (main → sub → analytical).
2. **Given** the chart, **When** an account is marked **group (non-postable)**, **Then** journal lines
   MUST NOT post to it — only **postable (leaf)** accounts accept lines.
3. **Given** the Foundation system accounts (treasury, receivable, payable, revenue, expense), **When**
   the chart is viewed, **Then** each appears as a postable account under its natural classification,
   without being redefined.
4. **Given** an account with posted ledger lines, **When** deletion is attempted, **Then** it is
   rejected (deactivate instead) — history is preserved (Principle IV).

---

### User Story 2 - Accountant posts a manual journal entry (Priority: P1)

An authorized user posts a **manual journal entry**: a dated, described, multi-line entry of debits and
credits against postable accounts, where total debits equal total credits. It posts to the Foundation
ledger as one balanced entry and is immutable thereafter.

**Why this priority**: Manual journals are how all non-automated accounting events (adjustments,
accruals, opening balances, expenses) enter the books — core A5Group functionality we lack.

**Independent Test**: Post a balanced entry (debit Expense 100 / credit Cash 100); confirm it appears in
the ledger, both account balances change accordingly, and an unbalanced entry is rejected.

**Acceptance Scenarios**:

1. **Given** ≥2 postable accounts, **When** a user posts a journal entry with Σdebits = Σcredits, **Then**
   it is recorded as one balanced Foundation ledger entry with a date, description, and per-line
   statement (بيان).
2. **Given** a journal entry where Σdebits ≠ Σcredits, **When** submitted, **Then** it is rejected.
3. **Given** a journal line targeting a **group (non-postable)** account, **When** submitted, **Then** it
   is rejected (FR — only leaf accounts).
4. **Given** a posted journal entry, **When** a correction is needed, **Then** a **reversing entry** is
   posted (new linked record); the original is never edited or deleted (Principle IV), reversible once.
5. **Given** a journal entry, **When** it is posted, **Then** the actor, timestamp, and before/after are
   recorded in the audit log.

---

### User Story 3 - Accountant enters opening balances (Priority: P2)

An authorized user records **opening balances** for accounts at the start of a period as a special
balanced journal entry (one side to an "Opening Balances Equity" account), so derived balances start
from the correct position.

**Why this priority**: A real chart of accounts is useless without opening balances when migrating from
the legacy system; but it depends on the chart (US1) and journals (US2) existing.

**Independent Test**: Enter opening balances for cash and a customer, confirm the entry balances against
the opening-equity account and the accounts' derived balances reflect the openings.

**Acceptance Scenarios**:

1. **Given** the chart, **When** opening balances are entered, **Then** they post as one balanced entry
   (each opening debit/credit offset by the Opening Balances Equity account).
2. **Given** opening balances exist, **When** an account balance is read, **Then** it includes the
   opening amount plus subsequent movements.

---

### User Story 4 - Accountant / manager views the trial balance (Priority: P1)

An authorized user views the **trial balance** (ميزان المراجعة): every account with its total debits,
total credits, and net balance for a date range, with totals where Σdebits = Σcredits across the book.
Group nodes roll up their children.

**Why this priority**: The trial balance is the primary proof the books balance and the entry point to
all accounting reports (Principle IX); it's the headline output of the GL.

**Independent Test**: After a few entries, open the trial balance for the period; confirm each account's
debit/credit/balance is the signed sum of its ledger lines, parent nodes roll up children, and the grand
total debits equal total credits.

**Acceptance Scenarios**:

1. **Given** posted entries, **When** the trial balance is generated for a date range, **Then** each
   postable account shows total debit, total credit, and net balance derived from its ledger lines.
2. **Given** the chart hierarchy, **When** the trial balance is viewed, **Then** group accounts show the
   rolled-up totals of their descendants.
3. **Given** any balanced book, **When** the trial balance totals are computed, **Then** total debits =
   total credits (the book always balances).
4. **Given** a date range, **When** the trial balance is generated, **Then** it includes opening balance,
   period movement, and closing balance per account.

---

### Edge Cases

- A journal entry MUST have ≥2 lines and balance (Σdebit = Σcredit); otherwise rejected.
- A journal line MUST target a **postable (leaf)** account; posting to a group node is rejected.
- An account that has children OR posted ledger lines MUST NOT be hard-deleted (deactivate instead).
- Making a postable account into a group is rejected if it already has posted lines.
- Account codes MUST be unique; reusing a code is rejected.
- A reversing entry of an already-reversed journal entry is rejected (reverse-once).
- A trial balance for a future/empty range returns zero rows/totals, not an error.
- Deactivating an account does not remove its historical lines from past trial balances.

## Requirements *(mandatory)*

### Functional Requirements

#### Chart of Accounts

- **FR-001**: The system MUST support a **hierarchical chart of accounts** of unbounded depth (parent →
  child), extending the Foundation `account` model additively (not a new ledger).
- **FR-002**: Each account MUST have a **unique code**, a **name**, a **classification/nature**
  (asset | liability | equity | income | expense), a **normal side** (debit/credit) derived from its
  nature, and an **is_postable** flag (group nodes are non-postable).
- **FR-003**: Only **postable (leaf)** accounts MAY receive journal lines; **group** accounts aggregate
  their descendants and MUST NOT receive lines directly.
- **FR-004**: The Foundation **system accounts** (treasury, custody, customer_receivable,
  supplier_payable, sales_revenue, purchases_expense, loyalty_expense) MUST appear as postable accounts
  within the chart under their natural classification, **without being redefined** or losing their links.
- **FR-005**: An account with children or with posted ledger lines MUST NOT be hard-deleted;
  deactivation MUST be used (history preserved, Principle IV).

#### Manual Journal Entries

- **FR-006**: An authorized user MUST be able to post a **manual journal entry** with a date, a
  description, and ≥2 lines, each line a debit or credit on a **postable** account with an amount and an
  optional per-line statement (بيان).
- **FR-007**: A journal entry MUST be rejected unless **Σdebits = Σcredits**.
- **FR-008**: A journal entry MUST post to the Foundation ledger as **one balanced entry**; balances
  remain ledger-derived.
- **FR-009**: A posted journal entry MUST be immutable; corrections are made by a **reversing entry**
  (new linked record), reversible at most once (Principle IV).
- **FR-010**: Every journal post and reversal MUST be recorded in the Foundation audit log (actor,
  timestamp, before/after).

#### Opening Balances

- **FR-011**: The system MUST support entering **opening balances** as a balanced journal entry that
  offsets each opening amount against an **Opening Balances Equity** account; opening amounts are
  included in derived balances.

#### Trial Balance

- **FR-012**: The system MUST produce a **trial balance** for a date range: per postable account the
  total debits, total credits, and net balance, all **derived** from ledger lines.
- **FR-013**: The trial balance MUST roll up **group** accounts as the aggregate of their descendants,
  and the grand total debits MUST equal grand total credits.
- **FR-014**: The trial balance MUST present, per account, **opening balance + period movement + closing
  balance** for the selected range.

#### Access Control & Scope

- **FR-015**: All chart and journal operations MUST enforce Foundation RBAC server-side (deny-by-default).
  A new **Accountant** role MUST be added with capabilities to manage the chart of accounts, post/reverse
  manual journal entries, enter opening balances, and view the trial balance. System Admin retains all
  capabilities; other roles have none of these by default.
- **FR-016**: The chart of accounts MUST be **company-wide** (single shared chart). Each journal entry
  MUST carry a **branch** attribution. A branch-scoped user MAY post only to their own branch, and the
  trial balance MUST be filterable by branch; System Admin sees all branches.
- **FR-017**: Account codes MUST follow a **segmented numeric scheme** with level segments (e.g.
  `1` → `1.01` → `1.01.001`), where a child's code is prefixed by its parent's code so the scheme
  enforces and reflects the hierarchy. Codes remain unique.

### Key Entities *(include if feature involves data)*

- **Account (extended)**: The Foundation account, extended into a chart node — `parent_id` (nullable),
  `code` (unique), `name`, `nature` (asset|liability|equity|income|expense), `normal_side`,
  `is_postable`, `active`. System accounts are postable leaves; user-defined groups/leaves are added.
- **Journal Entry**: A manual accounting event — date, description, actor, branch, posted as one
  Foundation `ledger_entry` with ≥2 balanced `ledger_line`s; immutable; optionally linked to a reversal.
- **Journal Line**: One debit/credit on a postable account with amount and statement (بيان) — realized as
  a Foundation `ledger_line`.
- **Opening Balances Equity**: A system account that balances opening-balance entries.
- **Trial Balance (derived view)**: Per account, opening/debit/credit/closing for a date range — not a
  stored table; computed from ledger lines.

*(Reused from Foundation, not redefined: Account, LedgerEntry, LedgerLine, Branch, Role, Audit Log,
plus the 001/002/003 system accounts.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can build a multi-level chart of accounts; 100% of attempts to post to a group
  (non-postable) account are rejected.
- **SC-002**: 100% of unbalanced journal entries (Σdebit ≠ Σcredit) are rejected; balanced ones post as
  one Foundation ledger entry.
- **SC-003**: Every account balance and trial-balance figure equals the signed sum of its ledger lines in
  100% of checks (no standalone stored balance disagrees).
- **SC-004**: The trial-balance grand total debits equal total credits in 100% of generated reports.
- **SC-005**: Every journal correction is a reversing entry with the original intact; a second reversal
  of the same entry is rejected.
- **SC-006**: The Foundation system accounts appear in the chart and continue to work for 001/002/003
  flows unchanged (no regression).

## Assumptions

- The chart of accounts **extends** the Foundation `account` table (additive columns) — one ledger, one
  account model; no parallel GL (Principle VI).
- An account's **normal side** is derived from its nature (asset/expense = debit; liability/equity/income
  = credit), consistent with the Foundation `normal_side`.
- **Cost centers** (A5Group dimension) are **out of scope** for this feature and handled as a separate
  additive dimension later; journal lines are designed to allow adding a cost-center reference without
  rework.
- **Multi-currency** is out of scope (Principle VIII, EGP only) — a separate constitution decision.
- Opening balances are entered as a journal entry against an Opening Balances Equity account (no special
  storage), keeping balances ledger-derived. v1 posts each opening amount on the account's **normal side**
  only (a contra opening — e.g. a customer carrying a credit balance or a bank overdraft — is entered via a
  regular journal entry instead; richer two-sided opening UI is deferred).
- A journal/opening entry carries a user-chosen **accounting date** (`entry_date`), distinct from the
  posting timestamp; the trial balance and all period reports filter by the accounting date.
- Account codes use a **segmented numeric scheme** (`1` → `1.01` → `1.01.001`) where a child's code is
  prefixed by its parent's; the code reflects and enforces the hierarchy.

## Out of Scope *(deferred to their own specs)*

- Cost centers (separate additive dimension).
- Multi-currency / foreign-currency accounts (constitution decision).
- Financial statements (P&L, balance sheet) and the broader reporting layer (separate Reporting spec).
- VAT / withholding tax.
- Payroll/HR accounts usage (Employees domain — final phase).

## Clarifications

### Session 2026-06-28

- Q: Which role(s) manage the chart and post manual journals? → A: **Add a new Accountant role** (FR-015).
- Q: Chart scope vs branch? → A: **Company-wide shared chart; journal entries tagged by branch**;
  branch-scoped users post to their own branch, trial balance filterable by branch (FR-016).
- Q: Account code scheme? → A: **Segmented numeric, level-based** (`1` → `1.01` → `1.01.001`), child code
  prefixed by parent (FR-017).
