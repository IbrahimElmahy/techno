# Specification Quality Checklist: Five Sale Price Tiers

**Feature**: `007-five-sale-price`
**Date**: 2026-06-29

## Content Quality

- [x] No implementation details beyond naming reused 002 primitives
- [x] Focused on user value (tiered pricing) and business needs
- [x] Written for stakeholders (managers, sellers)
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No `[NEEDS CLARIFICATION]` markers remain (3 resolved 2026-06-29)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases identified (fallback, snapshot, equal price, rep vs manager)
- [x] Scope clearly bounded (Out of Scope: units/serials/barcode/slab/time-phased)
- [x] Dependencies and assumptions identified (builds on 002 sales/catalog/customer)

## Constitution Alignment (v1.4.0)

- [x] Principle VI (One ledger): tiers only set the line price; money model unchanged
- [x] Principle VII (RBAC): new `sell.below_price` capability, deny-by-default; reps excluded
- [x] Principle VIII (Arabic RTL / EGP): unaffected; tier names are labels
- [x] Principle IX (Reporting): line records tier + actual price for analysis
- [x] Principle X (Test-First): independent tests per story

## Notes

- Additive: new item_price table, customer.default_price_tier, sales_invoice_line.price_tier; base
  sale_price kept as fallback (no 002 regression).
- Ready for `/speckit.plan`.
