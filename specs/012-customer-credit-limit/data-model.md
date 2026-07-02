# Data Model: Customer Credit Limit & Due-Term Enforcement (012)

## Extended entities (additive)

### `customer` (002) — two new nullable columns
| Column             | Type            | Null | Notes |
|--------------------|-----------------|------|-------|
| `credit_limit`     | `MONEY` (18,2)  | yes  | Max outstanding receivable, EGP. Null = unlimited. ≥ 0. |
| `max_due_term_days`| `INTEGER`       | yes  | Max allowed credit term in days. Null = no cap. ≥ 0. |

### `sales_invoice` (002) — one new nullable column
| Column      | Type   | Null | Notes |
|-------------|--------|------|-------|
| `due_date`  | `DATE` | yes  | `sale_date + due_term_days` for a credit sale with a term; null otherwise. |

No new tables. No column is dropped or redefined.

## Derived values (not stored)

- **outstanding_receivable(customer)** = `ledger_service.balance_of(customer.account.account_id)`.
- **available_credit** = `credit_limit − outstanding_receivable` (only meaningful when limit non-null).
- **over_limit** = `outstanding_receivable > credit_limit`.

## Invariants

- The credit-limit check reads the **derived** receivable at post time; no stored balance exists (III).
- A cash-only sale (credit portion 0) is never blocked by limit or term (FR-004).
- `credit_limit` is a ceiling: `outstanding + credit == credit_limit` is allowed; only strictly greater
  blocks (FR-002).
- `due_date` is set only for credit sales carrying a term; cash-only sales have `due_date` null (FR-006).

## Capability

- `sell.over_credit_limit` — RBAC grant (no table). Bypasses the amount ceiling only, not the term cap.
