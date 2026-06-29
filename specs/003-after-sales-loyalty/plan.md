# Implementation Plan: After-Sales Loyalty (Points & Coupons)

**Branch**: `003-after-sales-loyalty` | **Date**: 2026-06-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-after-sales-loyalty/spec.md`
**Builds on**: Foundation (`001`) + Sales & Inventory (`002`) — implemented and live on MySQL/MariaDB.

## Summary

Add the loyalty layer on top of 001/002: per-product point values, automatic point **earning** at
sales-invoice time (with return reversal), a customer **point balance derived** from an append-only
point ledger (may go negative — owed points), manual **points→coupons** conversion via a runtime
**coupon-type catalog**, and **coupon redemption** (money / gift-money-off → ledger; gift-product →
stock-only). All money posts to the **Foundation ledger** via a new additive `loyalty_expense` account
type; stock effects reuse the **002 stock service** (No-Negative-Stock XI). Built test-first
(Principle X) for serial uniqueness, balance derivation, reversal symmetry, and the
return-after-consumption hybrid.

## Technical Context

**Language/Version**: Python 3.12 (3.11 dev) — same as 001/002
**Primary Dependencies**: FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2 — reused
**Storage**: MySQL 8 / MariaDB 10.6+ (InnoDB, utf8mb4); money `DECIMAL(18,2)`, points `BIGINT` (integer)
**Testing**: pytest, httpx ASGI client; SQLite in-memory for unit/integration, MySQL for migration check
**Target Platform**: Linux server (same app, same schema)
**Project Type**: Web service — additive modules under the existing `backend/`
**Performance Goals**: point-balance derivation p95 < 300 ms; earning adds negligible latency to a sale
**Constraints**: ledger-derived balances only (incl. point balance from records); all money one
balanced entry; coupon serial unique; reverse-once; back-office only (no offline)
**Scale/Scope**: thousands of customers, low-tens of coupon types, unbounded append-only point/coupon
history

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Compliance |
|---|-----------|------------|
| I | Greenfield Only | New modules from spec; no legacy code. ✅ |
| II | Single Source of Truth (API contract) | OpenAPI extended additively under `contracts/`; drift-gated. ✅ |
| III | Offline-First Mobile | Loyalty is **back-office only**; no offline schema (spec assumption). ✅ |
| IV | Reversibility | Earn↔reverse, convert↔void-reclaim, redeem↔reverse — all append-only linked records; reverse-once. ✅ |
| V | Multi-Branch & Multi-Warehouse | Gift-product redemption decrements a chosen location via the 002 stock service. ✅ |
| VI | Treasury & Customer Accounts | Money posts to the **one** ledger; new `loyalty_expense` account type; balances derived. ✅ |
| VII | RBAC | Reuses deny-by-default; loyalty management restricted to After-Sales Staff (+admin); earning needs no extra capability. ✅ |
| VIII | Arabic RTL / EGP | EGP money type reused; presentation client-side. ✅ |
| IX | Reporting first-class | Point balance + loyalty_expense derived from records/ledger — reports read the source of truth. ✅ |
| X | Test-First (NON-NEGOTIABLE) | Serial uniqueness, balance derivation, reversal symmetry, and the return-after-consumption hybrid get failing tests first. ✅ |
| XI | No Negative Stock | Gift-product redemption is subject to the 002 No-Negative-Stock guard. ✅ |

**Gate result: PASS.** Three deliberate decisions are recorded in Complexity Tracking (justified).

## Project Structure

### Documentation (this feature)

```text
specs/003-after-sales-loyalty/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/openapi.yaml      # extended surface (this feature's endpoints)
└── tasks.md                    # /speckit.tasks output (not created here)
```

### Source Code (additive to the existing backend/)

```text
backend/src/
├── models/
│   ├── loyalty.py        # ProductPointValue, PointRecord (immutable), CouponType, Coupon, CouponRedemption, PointConversion
│   └── ledger.py         # EXTEND AccountType enum (+loyalty_expense)
├── services/
│   ├── point_service.py        # earn(), reverse_for_return(), balance(), convert(), void/adjust helpers
│   ├── coupon_service.py       # redeem_money(), redeem_gift_product(), redeem_gift_money_off(), reverse_redemption()
│   └── loyalty_hooks.py        # subscribes to the 002 sale events to earn / reverse points
├── core/
│   └── hooks.py          # tiny event registry (002 emits; 003 subscribes) — keeps 002 independent
├── api/
│   ├── loyalty_settings.py  product_points.py  coupons.py  points.py
├── migrations/versions/
│   └── 0003_after_sales_loyalty.py  # additive: ALTER account enum, new tables, point_record immutability trigger
└── tests/
    ├── unit/
    │   ├── test_point_balance.py          # balance = Σ records; may go negative
    │   ├── test_coupon_serial_unique.py   # uniqueness
    │   ├── test_money_coupon_ledger.py    # balanced loyalty_expense / receivable
    │   └── test_redemption_reversal.py    # reverse-once symmetry
    ├── integration/ (earn-on-sale, return reversal, convert, redeem money/gift, return-after-consumption hybrid)
    └── contract/   (extended OpenAPI shape + drift)
```

**Structure Decision**: One app, one schema, one Alembic history. Additive: new models/services/routers,
a single migration with down-revision `0002_sales_inventory`, the `AccountType` enum extended in place,
and a tiny hook registry so the 002 sales flow can emit earn/return events **without** importing 003.

## Complexity Tracking

> Deliberate structure beyond the simplest approach — justified, not constitution violations.

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| A **hook registry** (`core/hooks.py`): 002's `sales_service` emits `sale_created` / `sale_returned`; 003 subscribes to earn/reverse points in the **same transaction** | Earning MUST be an immutable record at invoice time (FR-003) and transactional with the sale, yet 003 builds on 002 — 002 must not import 003 | Importing 003 from 002 inverts the dependency; a 003-only endpoint called after the sale isn't transactional and can drift; deriving points from invoices forgoes the required immutable earn record and breaks the void/adjustment history |
| **Point ledger** (`point_record`, append-only, signed delta, kinds earn/reverse/converted/void_reclaim/adjustment); balance = Σ delta and **may go negative** | Mirrors the money/stock ledgers (Principle IV / derive-not-store); the Q3 hybrid (void unredeemed coupons; negative adjustment for redeemed) needs linked, immutable history and a balance that can go negative | A stored point balance drifts and cannot represent owed points; editing earn records on return violates immutability |
| Coupon **value/cost snapshot** onto the coupon at issuance (from the chosen `coupon_type`) | FR-015 — settings changes must not alter issued coupons; redemption math must use issuance-time values | Reading the live coupon type at redemption would retroactively change a coupon's worth when settings change |

> Note: gift-product redemption is **stock-only** (no ledger entry), consistent with 002's quantity-only
> inventory (deferred COGS). Only money / gift-money-off touch the ledger (loyalty_expense / receivable).
