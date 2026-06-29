# Specification Quality Checklist: Cost Centers (Analytical Dimension)

**Feature**: `006-cost-centers-optional`
**Date**: 2026-06-29

## Content Quality

- [x] No implementation details beyond naming reused Foundation/005 primitives
- [x] Focused on user value (analytical accounting) and business needs
- [x] Written for stakeholders (accountants)
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers remain (3 resolved inline — mirror 005 patterns)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified (partial tagging, deactivation, reversal copy)
- [x] Scope is clearly bounded (Out of Scope: documents, default-per-custody, reports, budgets)
- [x] Dependencies and assumptions identified (builds on 005 ledger/journal/trial-balance)

## Constitution Alignment (v1.4.0)

- [x] Principle IV (Reversibility): cost center copied onto reversal; master deactivated not deleted
- [x] Principle VI (One ledger, derived): dimension is a line attribute; no second store; derived by filter
- [x] Principle VII (RBAC): reuses 005 accounting capabilities, deny-by-default
- [x] Principle VIII (Arabic RTL / EGP): unaffected
- [x] Principle IX (Reporting first-class): trial balance gains an optional cost-center axis
- [x] Principle X (Test-First): independent tests per story

## Notes

- Purely additive: one new master table + one nullable column on `ledger_line`; 001/002/003 post NULL.
- Ready for `/speckit.plan`.
