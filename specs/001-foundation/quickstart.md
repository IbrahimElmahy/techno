# Quickstart: Foundation Backend

## Prerequisites

- Python 3.12, MySQL 8 / MariaDB 10.6+
- A database `ubms` (utf8mb4) and a user with DDL rights (for Alembic)

## Setup

```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt                    # fastapi, sqlalchemy, alembic, pydantic, passlib[bcrypt], python-jose, uvicorn, pytest, httpx
cp .env.example .env                               # set DATABASE_URL, JWT_SECRET, ACCESS_TOKEN_TTL
alembic upgrade head                               # creates all foundation tables + immutability trigger
python -m src.seed                                 # creates governorates + first System Admin
uvicorn src.main:app --reload
```

OpenAPI is served at `/docs` and `/openapi.json`; the committed contract is
`specs/001-foundation/contracts/openapi.yaml`.

## Smoke test (maps to spec acceptance scenarios)

1. **Admin sets up org (US1)**: `POST /auth/login` as admin → create branch + governorate →
   create central + branch warehouse → create one user per role → `GET /treasury/balance` returns
   `0.00` (ledger-derived).
2. **Branch isolation (US2)**: login as Branch A manager → `GET /customers` returns only Branch A;
   `GET /customers/{B}` → `403`.
3. **Customer + account (US3)**: create a `trader` customer → `GET /customers/{id}/account` →
   `balance: 0.00`, `balance_derived: true`. Reassign to Rep B → balance unchanged, prior entries
   still attributed to Rep A.
4. **Rep scope (US4)**: login as rep → `GET /customers` returns only that rep's; any other-rep id → `403`.
5. **Ledger reversal (IV)**: `POST /ledger/entries` (balanced) → `POST /ledger/entries/{id}/reverse`
   → second reverse → `409`. Treasury/custody balances net to expected derived values.

## Test strategy (Constitution Principle X — test-first)

Write these **failing** before implementing the corresponding service/endpoint.

### Unit (the four non-negotiable areas)

- `test_ledger_posting.py` — a balanced entry commits; an unbalanced entry (Σdebit≠Σcredit) is
  rejected; entries require ≥2 lines; posted rows cannot be UPDATEd/DELETEd (immutability guard).
- `test_ledger_reversal.py` — `reverse_entry` produces a mirror (debits↔credits swapped) linked via
  `reverses_entry_id`; reversing an already-reversed entry fails; original is untouched.
- `test_balance_derivation.py` — `balance_of(account)` equals Σ of its lines after a sequence of
  postings + a reversal; no stored balance column exists/diverges (SC-004).
- `test_access_control.py` — deny-by-default: an endpoint with no granted capability → 403; branch
  manager denied cross-branch read & write; rep denied other-rep data and all back-office actions;
  removed branch assignment denies mid-session.

### Integration

- Admin org-setup journey (US1) end-to-end; treasury starts at 0 derived.
- Customer reassignment keeps same `customer_account`/balance while old ledger entries stay attributed
  to the original rep (US3 scenario 4).
- Custody uniqueness: second custody for same rep/warehouse → 409.
- Audit: each of login(success/fail), role change, reassignment, deactivation, ledger post/reverse
  writes exactly one `audit_log_entry` with actor + timestamp + before/after (SC-007).

### Contract

- Every endpoint group validated against `contracts/openapi.yaml` (response shapes, error envelope,
  401/403/404/422 codes). FastAPI-generated `/openapi.json` MUST match the committed contract
  (drift check in CI per Principle II).

### Tooling

- `pytest -q`; integration tests run against a disposable MySQL schema (testcontainers or a
  per-run database dropped on teardown). Money assertions use `Decimal`, never float.
