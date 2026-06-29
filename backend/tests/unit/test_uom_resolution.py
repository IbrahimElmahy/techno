"""T007: unit → factor resolution (uom_service)."""
from decimal import Decimal

import pytest

from src.services import uom_service
from src.services.uom_service import UomError
from tests.conftest import make_priced_product, make_unit


def test_base_and_none_are_factor_one(db, world):
    item = make_priced_product(db, sale_price="10")  # base unit = 'piece'
    assert uom_service.resolve_factor(db, item, None) == Decimal("1")
    assert uom_service.resolve_factor(db, item, "piece") == Decimal("1")


def test_alternate_unit_factor(db, world):
    item = make_priced_product(db, sale_price="10")
    make_unit(db, item, "carton", 12)
    assert uom_service.resolve_factor(db, item, "carton") == Decimal("12.000")


def test_unknown_unit_raises(db, world):
    item = make_priced_product(db, sale_price="10")
    with pytest.raises(UomError):
        uom_service.resolve_factor(db, item, "pallet")
