# Specification Quality Checklist: After-Sales Loyalty (Points & Coupons)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- `/speckit.specify` clarifications resolved (2026-06-27): no expiry; whole-coupon conversion; and
  return-after-consumption hybrid (void unredeemed coupons, else negative adjustment, never blocking).
- A `/speckit.clarify` session (2026-06-27) resolved four further items in `## Clarifications`: coupon
  value/type via a runtime **coupon-type catalog**; gift redemption **mode chosen at redemption**;
  gift-as-product is **stock-only** (no ledger); gift **money-off posts like a money coupon**
  (`loyalty_expense` / receivable). All checklist items pass; spec is ready for `/speckit.plan`.
- Constitution v1.3.0 alignment: per-product point value, earn-per-product at invoice (cash/credit),
  sales-return reverses points (IV), manual points→coupons at a settings rate, coupon serial+type
  (money|gift), money coupon → receivable + `loyalty_expense` (additive ledger account type), gift
  coupon → product (No-Negative-Stock XI) or money-off, standalone or on-invoice redemption, no
  customer-to-customer transfer. Foundation/Sales primitives reused, not redefined.
- Items marked incomplete require resolution before `/speckit.plan`.
