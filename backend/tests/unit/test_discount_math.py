"""T032: combined % discount applied once to gross. FR-019; SC-006."""
from decimal import Decimal

import pytest

from src.services.sales_service import compute_net


def test_combined_applied_once_to_gross():
    # 5% + 10% = 15% off 1000 = 850.
    assert compute_net(Decimal("1000"), Decimal("15")) == Decimal("850.00")


def test_variable_only():
    assert compute_net(Decimal("1000"), Decimal("10")) == Decimal("900.00")


def test_zero_discount():
    assert compute_net(Decimal("250"), Decimal("0")) == Decimal("250.00")


def test_rounding_two_dp():
    # 7.5% off 333.33 = 308.33 (half-up at 2dp)
    assert compute_net(Decimal("333.33"), Decimal("7.5")) == Decimal("308.33")


@pytest.mark.parametrize("combined", [Decimal("100"), Decimal("120")])
def test_net_never_negative_guard_is_caller_side(combined):
    # compute_net itself is pure; create_sale rejects combined >= 100 (see test_sale.py).
    assert compute_net(Decimal("100"), combined) <= Decimal("0.00")
