"""Production calculation engine — pure, reusable, framework-free (014-production-reporting).

Library-First: these functions hold the *core* production math (recipe scaling, inventory routing,
material & resource costing) with no DB or FastAPI dependency, so they are unit-testable in isolation
and reused by `services/manufacturing_service.py`. All arithmetic uses Decimal via the money helpers.
"""
from __future__ import annotations

from decimal import Decimal

from src.core.money import to_money, to_qty
from src.models.stock import LocationKind


def scale_factor(output_quantity, produced_quantity) -> Decimal:
    """How many recipe batches the produced quantity represents (produced / batch yield)."""
    batch = to_qty(output_quantity)
    if batch <= to_qty(0):
        raise ValueError("Recipe output quantity must be positive.")
    return to_qty(produced_quantity) / batch


def consumed_quantity(component_quantity, scale) -> Decimal:
    """Base units of a component consumed = per-batch quantity × scale."""
    return to_qty(Decimal(component_quantity) * Decimal(scale))


def resolve_warehouse(
    item_default_warehouse_id: int | None,
    fallback_kind: LocationKind,
    fallback_id: int,
) -> tuple[LocationKind, int]:
    """Inventory routing: use the item's default warehouse when set, else the order's location.

    Routing keeps each item's stock in its own warehouse so balances stay accurate and orders don't
    silently pull from the wrong place.
    """
    if item_default_warehouse_id is not None:
        return LocationKind.warehouse, int(item_default_warehouse_id)
    return fallback_kind, int(fallback_id)


def line_cost(quantity, unit_cost) -> Decimal:
    """Money cost of a material line = quantity × unit cost (2dp)."""
    return to_money(Decimal(quantity) * Decimal(unit_cost))


def resource_cost(quantity, rate) -> Decimal:
    """Money cost of a resource line (labor/machine/overhead) = hours/units × rate (2dp)."""
    return to_money(Decimal(quantity) * Decimal(rate))


def unit_cost(total_cost, produced_quantity) -> Decimal:
    """Per-unit product cost = total cost / produced quantity (2dp; 0 if quantity is 0)."""
    qty = to_qty(produced_quantity)
    if qty <= to_qty(0):
        return to_money(0)
    return to_money(Decimal(total_cost) / qty)
