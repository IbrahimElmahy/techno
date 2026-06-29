"""T032: redemption reversal symmetry, reverse-once, redeem-once. FR-014; SC-006."""
from decimal import Decimal

import pytest

from src.models.loyalty import CouponKind, CouponStatus, CouponType, PointKind, PointRecord
from src.services import coupon_service, point_service
from src.services.coupon_service import CouponError


def _money_coupon(db, inv_world):
    from tests.conftest import make_customer_with_account
    cust, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"], code="C-RR")
    db.add(PointRecord(customer_id=cust.id, kind=PointKind.earn, delta=100))
    db.flush()
    ct = CouponType(name="M", kind=CouponKind.money, point_cost=50, value=Decimal("50"))
    db.add(ct)
    db.flush()
    coupon = point_service.convert(db, customer_id=cust.id, coupon_type_ids=[ct.id], actor_user_id=1)[0]
    db.commit()
    return coupon


def test_reverse_returns_coupon_to_issued(db, inv_world):
    coupon = _money_coupon(db, inv_world)
    coupon_service.redeem_money(db, coupon=coupon, actor_user_id=1)
    db.commit()
    assert coupon.status == CouponStatus.redeemed
    coupon_service.reverse_redemption(db, coupon=coupon, actor_user_id=1)
    db.commit()
    assert coupon.status == CouponStatus.issued


def test_reverse_once(db, inv_world):
    coupon = _money_coupon(db, inv_world)
    coupon_service.redeem_money(db, coupon=coupon, actor_user_id=1)
    db.commit()
    coupon_service.reverse_redemption(db, coupon=coupon, actor_user_id=1)
    db.commit()
    # coupon is back to issued; reversing again (no redeemed state) → error
    with pytest.raises(CouponError):
        coupon_service.reverse_redemption(db, coupon=coupon, actor_user_id=1)


def test_redeem_at_most_once(db, inv_world):
    coupon = _money_coupon(db, inv_world)
    coupon_service.redeem_money(db, coupon=coupon, actor_user_id=1)
    db.commit()
    with pytest.raises(CouponError):
        coupon_service.redeem_money(db, coupon=coupon, actor_user_id=1)
