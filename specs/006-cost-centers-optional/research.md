# Phase 0 Research: Cost Centers (Analytical Dimension)

The three spec clarifications (hierarchical master; reuse 005 accounting caps; optional per-line) were
resolved inline. The decisions below close the technical unknowns.

## R1 — Dimension placement: column on `ledger_line`

**Decision**: Add a nullable `cost_center_id` (FK → `cost_center.id`) directly on `ledger_line`. One
cost center per line; NULL means untagged.

**Rationale**: A5Group asks a single cost center per document line; the dimension is 1:1 and must filter
cheaply (one predicate). The line is the natural grain (account × cost center × amount × direction).
Keeps the immutable-line model intact (the FK is set at insert, never mutated).

**Alternatives rejected**: a `line_cost_center` join table (many-to-many — not needed, adds a join to
every report); a polymorphic tag table (overkill).

## R2 — Cost-center master shape

**Decision**: New table `cost_center(id, code UNIQUE, name, parent_id NULL FK self, active)`. Hierarchy
by `parent_id`, unbounded depth — same shape as the chart of accounts, but a **separate** table (a cost
center is not a ledger account and never bears a balance).

**Rationale**: Mirrors the chart for UI/roll-up familiarity; separate table keeps the dimension cleanly
orthogonal to the account axis (Principle VI — money lives only on the ledger line).

**Code scheme**: free unique string; a segmented convention (`1`, `1.01`) is recommended but not enforced
(unlike chart codes, cost centers have no posting-side semantics, so the strict prefix rule is unneeded).
Child requires an existing parent; no code-prefix constraint.

## R3 — Validation rules (master)

**Decision** (`cost_center_service`):
- `code` unique (DB unique index + service check).
- `parent_id`, if given, must reference an existing cost center.
- Hard-delete forbidden when the cost center has tagged ledger lines OR active children → `deactivate`
  (set `active=False`); deactivated centers stay on historical lines.
- Only `active` centers may be attached to a new line (enforced in `journal_service`).

**Rationale**: Mirrors 005 chart rules (Principle IV — preserve history).

## R4 — Threading the dimension through the ledger

**Decision**:
- `ledger_service.LineInput` gains `cost_center_id: int | None = None`; `post_entry` writes it onto each
  `LedgerLine`. **Backward-compatible** default None — 001/002/003 callers are unchanged.
- `ledger_service.reverse_entry` copies `line.cost_center_id` onto each swapped mirror line (FR-006), so
  a reversal nets within the same cost center.
- `journal_service.post_entry` accepts an optional cost center per line; before posting it validates each
  referenced center exists and is **active** (rejects deactivated/unknown, FR-005).

**Rationale**: One additive optional field flows end-to-end; immutability and reverse-once are inherited.

## R5 — Filtered trial balance

**Decision**: `trial_balance_service.trial_balance` gains `cost_center_id: int | None = None`. When set,
only lines whose `cost_center_id == filter` are aggregated (the opening/period bucketing is otherwise
identical). When None, behaviour is byte-for-byte unchanged (no regression).

**Rationale**: A single extra predicate over the already-loaded lines; pure derivation (Principle IX).
Per-cost-center totals may be unequal under partial tagging — surfaced via the existing `balanced` flag,
not an error (Assumptions).

## R6 — RBAC

**Decision**: Reuse 005 capabilities — `accounting.chart.read/write` for cost-center read/manage (a cost
center is chart-adjacent master data) and `accounting.trial_balance.read` for the filtered analysis. No
new role, no new capability.

**Rationale**: Same Accountant authority; avoids RBAC sprawl (Complexity Tracking).

## R7 — Migration

**Decision**: `0005_cost_centers.py` (down-revision `0004_general_ledger`):
1. `create_table('cost_center', ...)` with a unique index on `code` and a self-FK on `parent_id`.
2. `ALTER TABLE ledger_line ADD COLUMN cost_center_id BIGINT NULL` + FK + index.
No enum changes; no data backfill (existing lines keep NULL). SQLite (tests) builds from models via
`create_all`; the migration matters for MySQL. Idempotent dialect guards as in prior migrations.

**Rationale**: Consistent with the 0002–0004 additive style; smallest possible footprint.
