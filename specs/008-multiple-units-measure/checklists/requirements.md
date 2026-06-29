# Specification Quality Checklist: Multiple Units of Measure

**Feature**: `008-multiple-units-measure`
**Date**: 2026-06-29

## Content Quality

- [x] No implementation details beyond naming reused 002/007 primitives
- [x] Focused on user value (transact in any unit) and business needs
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers remain (2 resolved 2026-06-29)
- [x] Requirements testable and unambiguous
- [x] Success criteria measurable and technology-agnostic
- [x] Acceptance scenarios + edge cases defined (base-unit stock, snapshot, returns)
- [x] Scope bounded (Out of Scope: per-unit prices, serials, barcode, valuation)
- [x] Dependencies/assumptions identified (002 stock, 007 tiers)

## Constitution Alignment (v1.4.0)

- [x] Principle VI (One ledger): units only convert qty/scale price; money model unchanged
- [x] Principle XI (No Negative Stock): on-hand + guard in base units
- [x] Principle VII (RBAC): reuses catalog.write; no new role
- [x] Principle IX (Reporting): line records unit + factor for analysis
- [x] Principle X (Test-First): independent tests per story

## Notes

- Additive: new item_unit table + unit/unit_factor columns on sales & purchase lines; base unit_of_measure
  kept (factor 1) so 002/007 are unchanged.
- Ready for `/speckit.plan`.
