# Specification Quality Checklist: Serial Numbers per Item

**Feature**: `009-serial-numbers-per` · **Date**: 2026-06-29

## Content Quality
- [x] No implementation details beyond naming reused 002/008 primitives
- [x] Focused on user value (traceability) and business needs
- [x] All mandatory sections completed

## Requirement Completeness
- [x] No `[NEEDS CLARIFICATION]` markers remain (2 resolved 2026-06-29)
- [x] Requirements testable and unambiguous
- [x] Success criteria measurable and technology-agnostic
- [x] Acceptance scenarios + edge cases defined (receive/sell/return, wrong state)
- [x] Scope bounded (Out of Scope: purchase/produce/transfer capture, barcode, warranty)
- [x] Dependencies/assumptions identified (002 stock, 008 base unit)

## Constitution Alignment (v1.4.0)
- [x] Principle VI (One ledger): serials add traceability; money model unchanged
- [x] Principle XI (No Negative Stock): every serial move posts a quantity movement; on-hand authoritative
- [x] Principle VII (RBAC): reuses catalog.write / purchase.write / sale.write; no new role
- [x] Principle IX (Reporting): serial registry enables traceability
- [x] Principle X (Test-First): independent tests per story

## Notes
- Additive: item.is_serialized + item_serial table; receive/sale/return keep serial count == on-hand.
- Ready for `/speckit.plan`.
