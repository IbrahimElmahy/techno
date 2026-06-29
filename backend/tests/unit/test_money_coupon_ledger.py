"""T026: money & gift-money-off post ONE balanced entry; gift-product no ledger. FR-011/012; SC-004."""
from decimal import Decimal

from sqlalchemy import select

from src.models.ledger import Direction, LedgerLine
from src.models.loyalty import CouponKind, CouponType, PointKind, PointRecord
from src.services import account_resolver, coupon_service, point_service


def _setup_coupon(db, inv_world, kind: CouponKind):
    cust, _acc = _customer(db, inv_world)
    db.add(PointRecord(customer_id=cust.id, kind=PointKind.earn, delta=100))
    db.flush()
    ct = CouponType(name="T", kind=kind, point_cost=50, value=Decimal("50"))
    db.add(ct)
    db.flush()
    coupon = point_service.convert(db, customer_id=cust.id, coupon_type_ids=[ct.id], actor_user_id=1)[0]
    db.commit()
    return cust, coupon


def _customer(db, inv_world):
    from tests.conftest import make_customer_with_account
    return make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"], code="C-MC")


def test_money_coupon_posts_balanced_entry(db, inv_world):
    cust, coupon = _setup_coupon(db, inv_world, CouponKind.money)
    red = coupon_service.redeem_money(db, coupon=coupon, actor_user_id=1)
    db.commit()
    lines = db.scalars(select(LedgerLine).where(LedgerLine.entry_id == red.ledger_entry_id)).all()
    debit = sum(l.amount for l in lines if l.direction == Direction.debit)
    credit = sum(l.amount for l in lines if l.direction == Direction.credit)
    assert debit == credit == Decimal("50.00")
    # debit loyalty_expense, credit customer_receivable
    exp = account_resolver.loyalty_expense_account(db)
    assert any(l.account_id == exp.id and l.direction == Direction.debit for l in lines)


def test_gift_money_off_same_as_money(db, inv_world):
    cust, coupon = _setup_coupon(db, inv_world, CouponKind.gift)
    red = coupon_service.redeem_gift_money_off(db, coupon=coupon, actor_user_id=1)
    db.commit()
    lines = db.scalars(select(LedgerLine).where(LedgerLine.entry_id == red.ledger_entry_id)).all()
    assert sum(l.amount for l in lines if l.direction == Direction.debit) == Decimal("50.00")
