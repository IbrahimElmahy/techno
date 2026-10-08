from __future__ import annotations

from decimal import Decimal

from src.core.money import to_factor, to_money, to_qty
from src.models.stock import LocationKind


def scale_factor(output_quantity, produced_quantity) -> Decimal:
    batch = to_qty(output_quantity)
    if batch <= to_qty(0):
        raise ValueError("كمية ناتج التركيبة لازم تكون أكبر من صفر.")
    return to_qty(produced_quantity) / batch


def consumed_quantity(component_quantity, scale, unit_factor=1) -> Decimal:
    factor = to_factor(unit_factor or 1)
    if factor <= to_qty(0):
        raise ValueError("معامل الوحدة لازم يكون أكبر من صفر.")
    return to_qty(Decimal(component_quantity) * Decimal(scale) * factor)


def resolve_warehouse(
    item_default_warehouse_id: int | None,
    fallback_kind: LocationKind,
    fallback_id: int,
) -> tuple[LocationKind, int]:
    if item_default_warehouse_id is not None:
        return LocationKind.warehouse, int(item_default_warehouse_id)
    return fallback_kind, int(fallback_id)


def line_cost(quantity, unit_cost) -> Decimal:
    return to_money(Decimal(quantity) * Decimal(unit_cost))


def resource_cost(quantity, rate) -> Decimal:
    return to_money(Decimal(quantity) * Decimal(rate))


def unit_cost(total_cost, produced_quantity) -> Decimal:
    qty = to_qty(produced_quantity)
    if qty <= to_qty(0):
        return to_money(0)
    return to_money(Decimal(total_cost) / qty)
