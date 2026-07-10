"""Unit tests for the pure production engine (014). Library-First: no DB, no app."""
from decimal import Decimal

import pytest

from src.lib import production
from src.models.stock import LocationKind


def test_scale_factor():
    assert production.scale_factor("5", "10") == Decimal("2.000")
    assert production.scale_factor("2", "1") == Decimal("0.500")


def test_scale_factor_rejects_zero_batch():
    with pytest.raises(ValueError):
        production.scale_factor("0", "10")


def test_consumed_quantity_scales():
    # 2 kg per batch × scale 2 = 4 kg
    assert production.consumed_quantity("2", Decimal("2.000")) == Decimal("4.000")


def test_resolve_warehouse_uses_item_default_then_fallback():
    # item has its own warehouse -> route there
    assert production.resolve_warehouse(7, LocationKind.warehouse, 1) == (LocationKind.warehouse, 7)
    # no default -> fall back to the order's location
    assert production.resolve_warehouse(None, LocationKind.custody, 3) == (LocationKind.custody, 3)


def test_costs():
    assert production.line_cost("4", "10") == Decimal("40.00")
    assert production.resource_cost("3", "25") == Decimal("75.00")
    assert production.unit_cost("72.00", "10") == Decimal("7.20")
    assert production.unit_cost("50.00", "0") == Decimal("0.00")
