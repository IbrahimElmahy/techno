# Specification Quality Checklist: Stock Min/Max Limits & Expiry Batches

**Feature**: `011-stock-min-max` · **Date**: 2026-06-30

## Content Quality
- [x] No implementation details beyond naming reused 002/008 primitives
- [x] Focused on user value (reorder planning + expiry rotation)
- [x] All mandatory sections completed

## Requirement Completeness
- [x] No `[NEEDS CLARIFICATION]` markers remain (scope resolved 2026-06-30)
- [x] Requirements testable and unambiguous
- [x] Success criteria measurable and technology-agnostic
- [x] Acceptance scenarios + edge cases defined (advisory limits, FEFO, batch=on-hand)
- [x] Scope bounded (Out of Scope: per-store min/max, auto-PO, valuation, serial+batch)
- [x] Dependencies/assumptions identified (002 stock, base unit)

## Constitution Alignment (v1.4.0)
- [x] Principle VI (One ledger): limits/batches add planning; money model unchanged
- [x] Principle XI (No Negative Stock): every batch move posts a quantity movement; on-hand authoritative
- [x] Principle VII (RBAC): reuses catalog.write / purchase.write / stock.read; no new role
- [x] Principle IX (Reporting): reorder + expiring reports over the source of truth
- [x] Principle X (Test-First): independent tests per story

## Notes
- Additive: item min/max + is_perishable + stock_batch table; receive/sale/return keep batch sum == on-hand.
- Ready for `/speckit.plan`.
