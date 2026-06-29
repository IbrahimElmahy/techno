# Phase 0 Research: Sales & Inventory

Stack and most behavior are fixed by the spec, the clarifications, and constitution v1.2.0. This
records the design decisions that shape Phase 1, with rationale and rejected alternatives. It assumes
the implemented Foundation (ledger, RBAC, customers, warehouses, custodies, audit).

## R1. Extend the ledger account model — required balancing accounts

- **Status**: **Approved (PM, 2026-06-25)** — accepted as a necessary accounting requirement that
  respects the deferral of inventory valuation and enables revenue/purchases reporting.
- **Decision**: Add three `account_type` values to the Foundation `account` enum:
  `supplier_payable`, `sales_revenue`, `purchases_expense`. No new ledger, no balance store.
- **Rationale**: Double-entry MUST balance (Foundation rejects unbalanced entries). With stock
  quantity-only (clarification Q4), money entries still need balancing counter-accounts:
  - **Sale** (net 850 = 300 cash + 550 credit): debit cash-location 300, debit customer_receivable
    550, **credit sales_revenue 850**.
  - **Purchase** (1000 = 400 cash + 600 credit): **debit purchases_expense 1000**, credit
    cash-location 400, credit supplier_payable 600.
  - `supplier_payable` mirrors `customer_receivable` (normal credit side); a supplier has a
    `supplier_account` → one `account` row, balance ledger-derived.
- **Reconciliation with Q4**: Q4 deferred **inventory valuation and COGS**, not revenue/expense.
  Purchases are expensed when bought and sales recognized when sold; inventory is never capitalized as
  an asset. Recorded as a Complexity Tracking item.
- **Alternatives considered**: single equity/clearing account (obscures revenue vs cost, blocks future
  P&L reporting); capitalize inventory as an asset (contradicts Q4, reintroduces COGS).

## R2. Stock as an append-only movement ledger; on-hand derived

- **Decision**: `stock_movement` is immutable and append-only (mirrors the money ledger). Each row:
  `item_id`, `location_kind` (warehouse|custody), `location_id`, `movement_type`, `direction`
  (in|out), `quantity DECIMAL(18,3) > 0`, `reverses_movement_id` (UNIQUE, self-FK),
  `source_doc_type`/`source_doc_id`, `actor_user_id`, `created_at`.
  On-hand(item, location) = `Σ(in − out)`. No stored on-hand column anywhere.
- **Rationale**: Principle IV/XI + SC-002. Quantity is multi-dimensional (item × location × unit) and
  cannot be a money `ledger_line`; a parallel quantity ledger keeps it derived and reversible.
- **Immutability**: ORM event guard + MySQL trigger rejecting UPDATE/DELETE on `stock_movement`
  (identical pattern to `ledger_entry`/`ledger_line`).
- **Alternatives considered**: stored `quantity_on_hand` (drifts; rejected); reuse money ledger lines
  for stock (conflates units and currency).

## R3. No-Negative-Stock enforcement under concurrency

- **Decision**: `stock_locator(item_id, location_kind, location_id)` UNIQUE — a row created on first
  touch and used purely as a `SELECT … FOR UPDATE` **lock anchor**. Every stock write: lock the
  locator, compute on-hand from movements, reject if the `out` would drive it < 0 (Principle XI), else
  insert the movement(s), commit. The locator stores **no** authoritative quantity.
- **Rationale**: serializes concurrent writers for the same (item, location) so the
  check-then-insert is atomic, without a drift-prone stored balance. Lock scope is minimal (one
  locator row), so unrelated items/locations never contend.
- **Alternatives considered**: optimistic recompute (two concurrent sales can both pass then go
  negative); table-level lock (too coarse); cached balance (drift).

## R4. Catalog & items

- **Decision**: One `item` table, `kind` ∈ {raw_material, product}. Common: system-generated
  **editable** `code` (UNIQUE), `name`, `unit_of_measure`, `active`. Kind-specific: raw materials
  carry a reference `purchase_price`; products carry one fixed `sale_price`. Quantities are
  `DECIMAL(18,3)` (Q5). Items store no quantity.
- **Rationale**: FR-001–005, FR-002a. Editing a reference price never rewrites prices recorded on
  posted documents (snapshots live on invoice lines).
- **Validation**: raw materials are not sellable; products are not purchasable (enforced in services
  and at line-build time).

## R5. Purchases & supplier payables

- **Decision**: `purchase_invoice` (supplier, destination location, cash_amount, credit_amount,
  total, `ledger_entry_id`, document_number) + `purchase_invoice_line` (raw item, quantity,
  unit_price snapshot, line_total). On post: one `purchases_in` stock movement per line (subject to
  R3) + one balanced ledger entry (R1). `purchase_return`(+lines) is partial: cumulative returned per
  line ≤ purchased; posts `purchase_return_out` movements + a proportional reversing ledger entry.
- **Rationale**: FR-009–012; clarified supplier credit + partial returns.

## R6. Sales invoices — discount, split cash/credit, cash destination

- **Decision**: `sales_invoice` snapshots `gross`, `fixed_discount_pct`, `variable_discount_pct`,
  `combined_pct = fixed+variable`, `net = round(gross × (1 − combined_pct/100), 2)`, `cash_amount`,
  `credit_amount` (cash+credit = net), `customer_id`, origin location, `ledger_entry_id`,
  `document_number`. Lines snapshot the product's fixed `unit_price`. On post: one `sale_out` movement
  per line at the **origin** location (Principle V, R3) + one balanced ledger entry — debit the
  **actor's cash location** for the cash part (rep sale → rep custody account; branch sale → branch
  treasury/custody), debit `customer_receivable` for the credit part, credit `sales_revenue` for the
  net. `sales_return`(+lines) is partial and reverses proportional stock + money.
- **Rationale**: FR-017–021 and clarifications Q1/Q2/Q3. Rounding is half-up at 2 dp on the net; lines
  use the same money type.
- **Cash location resolution**: derived from the acting user — a Sales Rep maps to their custody
  account; otherwise the branch's treasury/custody. This reuses Foundation custody/treasury accounts.

## R7. Manufacturing — two independent operations

- **Decision**: `manufacturing_op` with `op_type` ∈ {consume, produce}; a consume decrements a raw
  material at a location (R3), a produce increments a product at any location. Each is one stock
  movement, independently reversible. No linkage, no BOM, no money effect (stock quantity-only).
- **Reversal (FR-016)**: an explicit reverse operation on a `manufacturing_op` creates a linked mirror
  stock movement via `stock_service.reverse_movement` (reverse-once); exposed as
  `POST /manufacturing/{id}/reverse`. No money effect. A reversed consume returns stock; a reversed
  produce removes it (subject to No-Negative-Stock).
- **Rationale**: FR-013–016; constitution Domain Scope item 1 (decoupled, BOM-free).

## R8. Stock transfers — approval state machine

- **Decision**: `stock_transfer`(item, quantity, source loc, dest loc, route ∈ {central→branch,
  central→rep, rep→rep}, status ∈ {pending, approved, rejected, reversed}, initiated_by, approved_by).
  No stock moves while pending. On **Branch-Manager** approval: post `transfer_out` at source +
  `transfer_in` at destination atomically (both under R3 locks, source checked for no-negative).
  Reverse-transfer posts the mirror pair. Route legality validated against the location kinds.
- **Approver scope**: the approving Branch Manager MUST manage the **source location's branch**; for
  central→branch and central→rep (source = central warehouse) the head-office/central authority
  approves. A non-source-branch manager is denied (FR-023).
- **Rationale**: FR-022–024; approval restricted to Branch Manager (FR-027).

## R9. Returns — partial, proportional, reversible

- **Decision**: Returns are independent linked records (not ledger "reversals" of the original). The
  caller supplies **only** per-line returned quantities; the service enforces cumulative-returned ≤
  original. Money reversal is **proportional and automatic**: the system computes the split from the
  **original document's cash/credit composition** and applies it to the returned value — the caller
  never supplies the money split (symmetric for sales and purchase returns). A sales return refunds
  `cash%` of the returned value to the cash location and reduces customer_receivable by `credit%`; a
  purchase return reduces supplier_payable by `credit%` and treasury/custody by `cash%`. Each return is
  itself reversible.
- **Rationale**: clarification Q (partial returns); Principle IV; cross-artifact fix I1/I2.

## R10. Document numbering

- **Decision**: Server-generated, unique, human-readable `document_number` per document type with a
  monotonic per-type sequence and a prefix: `PINV-######` (purchase), `SINV-######` (sale),
  `PRET-/SRET-######` (returns), `TRF-######` (transfer), `MFG-######` (manufacturing). Generated
  inside the posting transaction; uniqueness enforced by a UNIQUE column.
- **Rationale**: printable invoices need stable identifiers; spec left the scheme to the plan. Branch
  scoping is captured by the document's location/branch fields, so a global per-type sequence keeps
  numbering simple and collision-free.
- **Alternatives considered**: per-branch sequences (more complex, needed only if legally required —
  not stated).

## R11. Migration approach (additive)

- **Decision**: One Alembic revision `0002_sales_inventory`, `down_revision = 0001_baseline`. It
  (a) extends the `account` enum with the three new values (MySQL `MODIFY COLUMN`), (b) creates all new
  tables, (c) installs the `stock_movement` immutability triggers (UPDATE/DELETE) like the ledger. No
  Foundation table is dropped or redefined; no data backfill (legacy migration is separate).
- **Rationale**: Principle I + additive-only integration. SQLite test path uses `create_all` + the ORM
  immutability guard (triggers are MySQL-only, mirroring Foundation).

## R12. RBAC capability additions

- **Decision**: Extend the Foundation role→capability map (no new mechanism): `catalog.read/write`,
  `supplier.read/write`, `purchase.write`, `manufacture.write`, `sale.write`, `transfer.initiate`,
  `transfer.approve`, `stock.read`, `return.write`, `settings.write`. Mapped per the clarified roles:
  sales → Sales Rep / Sales Manager / Branch Manager; manufacture → Branch Manager / Purchasing
  Manager; purchasing → Purchasing Manager; transfer approval → Branch Manager. Rep writes are
  scoped to their own custody/customers; branch roles to their branch.
- **Rationale**: FR-026–028; reuse deny-by-default + scope predicates.
