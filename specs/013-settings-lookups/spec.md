# 013 — Configurable Dropdown Lists (Settings → Lookups)

**Status**: implemented (v2.1)

## Context

The client asked to control the options of dropdown fields from a settings screen, organized per
page. Previously every dropdown was hardcoded (enum + Arabic label maps in the frontend). This adds
an admin-configurable **lookup** system so option labels/order/visibility (and, for free lists,
the option set itself) are data-driven.

## Model

Every configurable dropdown reads from `lookup_option(id, category, value, label, sort_order,
active, is_system)` keyed by `category`. Two category kinds (registry in
`backend/src/services/lookup_registry.py`):

- **system** (enum-bound: `item_kind`, `price_tier`, `customer_type`, `coupon_kind`,
  `redemption_mode`, `warehouse_type`, `holder_type`, `location_kind`): seeded from the backend Enum.
  The admin MAY **relabel, reorder, and hide** options, but MUST NOT add/delete values — business
  logic switches on the enum. Enforced in `lookup_service` (`is_system=True` rows).
- **custom** (free lists: `unit_of_measure`, `payment_method`, `customer_type`): full add/edit/remove.
  `customer_type` was converted from an Enum column to a free `String` — no logic branches on it, so
  admins can add their own customer types. A guarded startup fixup (`_relax_configurable_enum_columns`
  in `main.py`) widens the existing native-ENUM column to VARCHAR on Postgres/MySQL, since the
  create_all deploy path never alters columns. **Genuinely structural enums stay locked** (item_kind,
  price_tier, location_kind, holder_type, warehouse_type, coupon_kind, redemption_mode): their values
  are consumed directly by pricing/inventory/manufacturing/redemption logic, so a new value would be
  selectable but non-functional — extending one is a code change, not a settings change.

Options are **lazily seeded** from the registry on first read, so fresh DBs and tests always have
defaults with no explicit seed step.

## API (`/settings/lookups`)

- `GET /settings/lookups/categories` — registry grouped by page (for the Settings UI).
- `GET /settings/lookups?category=X&active_only=` — options (reads: any authenticated user).
- `POST /settings/lookups` — add option (custom categories only).
- `PATCH /settings/lookups/{id}` — relabel / reorder / toggle active.
- `DELETE /settings/lookups/{id}` — remove (custom only; system → hide instead).

Writes require `settings.write` (System Admin / Branch Manager). Migration `0011_lookups`.

## Frontend

- **Settings page** (`frontend/src/pages/Settings.tsx`, route `/settings`, admin menu): per-page
  sections; each category is an editable table (inline relabel, sort order, active toggle; add/delete
  for custom; system options show a lock).
- **`useLookup(category)` hook** (`frontend/src/hooks/useLookup.ts`): fetches active options with a
  hardcoded fallback so forms never break. Wired into Catalog (`item_kind`, `unit_of_measure`) and
  Customers (`customer_type`); other dropdowns adopt the same hook incrementally.

## Out of scope

- Adding brand-new enum-bound values (would require backend logic for the new value).
- Migrating already-stored free-text units to the lookup set (existing data is untouched).
