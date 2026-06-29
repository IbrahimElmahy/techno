"""T021: coupon serials are unique. FR-009; SC-003."""
import pytest
from sqlalchemy.exc import IntegrityError

from src.models.customer import Customer
from src.models.loyalty import Coupon, CouponKind, CouponType, PointConversion, PointKind, PointRecord
from src.services import point_service


def _customer_with_points(db, pts):
    c = Customer(code="C-SER", name="S", customer_type="trader", rep_id=1, territory_id=1)
    db.add(c)
    db.flush()
    db.add(PointRecord(customer_id=c.id, kind=PointKind.earn, delta=pts))
    db.flush()
    return c


def test_convert_issues_unique_serials(db):
    c = _customer_with_points(db, 150)
    ct = CouponType(name="M50", kind=CouponKind.money, point_cost=50, value=50)
    db.add(ct)
    db.flush()
    coupons = point_service.convert(db, customer_id=c.id, coupon_type_ids=[ct.id, ct.id, ct.id],
                                    actor_user_id=1)
    db.commit()
    serials = [x.serial for x in coupons]
    assert len(serials) == 3 and len(set(serials)) == 3


def test_duplicate_serial_rejected(db):
    c = _customer_with_points(db, 0)
    conv = PointConversion(customer_id=c.id, actor_user_id=1)
    db.add(conv)
    db.flush()
    ct = CouponType(name="M", kind=CouponKind.money, point_cost=10, value=10)
    db.add(ct)
    db.flush()
    db.add(Coupon(serial="CPN-DUP", customer_id=c.id, coupon_type_id=ct.id, kind=CouponKind.money,
                  value=10, points_consumed=10, conversion_id=conv.id))
    db.flush()
    db.add(Coupon(serial="CPN-DUP", customer_id=c.id, coupon_type_id=ct.id, kind=CouponKind.money,
                  value=10, points_consumed=10, conversion_id=conv.id))
    with pytest.raises(IntegrityError):
        db.flush()
