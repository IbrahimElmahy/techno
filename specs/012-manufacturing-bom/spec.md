# 012 — Recipe-driven Manufacturing (Bill of Materials)

**Status**: implemented (v2)
**Owner spec extends**: 002-sales-inventory (Manufacturing, FR-013–016)

## Context

The v1 system implemented manufacturing as two decoupled stock operations (consume raw material /
produce product, no linkage, no BOM) per FR-013–016 and the constitution's original "decoupled,
BOM-free" domain scope. The client (echoing the legacy A5Group system's `أمر شغل` work orders +
auto-issue-raw-materials) requested the linked model back: a raw material is fed in, manufactured,
and yields products — with the raw-material consumption driven automatically by the product's recipe.

This spec adds a **recipe-driven manufacturing order** alongside (not replacing) the decoupled
primitive, which is retained for manual/unplanned adjustments.

## Functional Requirements

- **FR-012-01 (Recipe/BOM)**: Each product MAY have one or more recipes; at most **one active**
  recipe per product. A recipe declares an `output_quantity` (base units produced per batch) and a
  list of raw-material components with per-batch quantities. Components MUST be raw materials; the
  output MUST be a product. Recipes are master data — freely editable and deactivatable in place.
- **FR-012-02 (Manufacturing order)**: A manufacturing order names a product, a produced quantity,
  and a location. It loads the product's active recipe (or an explicit `bom_id`), scales each
  component by `produced_qty / output_quantity`, and in **one transaction** posts a `consumption_out`
  movement per component and a single `production_in` movement for the product.
- **FR-012-03 (Cost)**: The order derives and stores a cost = `Σ(component base qty × raw material
  purchase_price)`, plus a `unit_cost = total_cost / produced_qty`. Cost is **stored for reporting
  only** — manufacturing posts **no ledger entry** (Q4 money boundary preserved; stock stays
  quantity-only).
- **FR-012-04 (No-negative stock)**: Each component consumption obeys no-negative-stock. If any
  component is short, the **whole order fails** (atomic).
- **FR-012-05 (Reverse-once)**: An order is reversible at most once via a mirror order that returns
  every consumed component to stock and removes the produced product. Removing the product obeys
  no-negative-stock (a reversal fails if the product was already sold/consumed).
- **FR-012-06 (RBAC)**: Recipe + order **writes** require `manufacture.write`; **reads** (recipe and
  order lists/detail) require the new `manufacture.read`. Granted to System Admin, Branch Manager,
  Purchasing Manager (read also to Sales Manager, After-Sales Staff).

## Data model

- `bom(id, product_id→item, name, output_quantity QTY, active, created_at)`
- `bom_component(id, bom_id→bom, item_id→item, quantity QTY)`
- `manufacturing_order(id, document_number 'MO-######', product_id, bom_id, location_kind,
  location_id, quantity QTY, unit_cost MONEY, total_cost MONEY, stock_movement_id, reverses_order_id,
  actor_user_id, created_at)`
- `manufacturing_order_consumption(id, order_id, item_id, quantity QTY, unit_cost, line_cost,
  stock_movement_id)`

Migration: `0010_manufacturing_bom`.

## API

- `GET/POST /manufacturing/boms`, `GET/PUT/DELETE /manufacturing/boms/{id}`
- `GET/POST /manufacturing/orders`, `GET /manufacturing/orders/{id}`,
  `POST /manufacturing/orders/{id}/reverse`
- The decoupled `POST /manufacturing/consume|produce` + `/{op_id}/reverse` remain for manual ops.

## Out of scope

- Inventory valuation / WIP ledger postings (cost stays off-ledger).
- Multi-output recipes (one product output per recipe).
- Auto-issue of raw materials directly from a sales invoice (legacy A5Group behavior) — not requested.
