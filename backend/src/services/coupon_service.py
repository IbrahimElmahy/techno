"""Coupon redemption + reversal (T028/T029/T033). FR-011–014.

Money & gift-money-off post one balanced ledger entry (debit loyalty_expense, credit
customer_receivable). Gift-product decrements stock via the 002 service (no-negative, no ledger).
Only `issued` coupons redeem (I1); every redemption is reversible (reverse-once) and returns the
coupon to `issued`.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.catalog import Item, ItemKind
from src.models.customer import CustomerAccount
from src.models.ledger import Direction
from src.models.loyalty import (
    Coupon,
    CouponKind,
    CouponRedemption,
    CouponStatus,
    RedemptionMode,
)
from src.models.stock import LocationKind, StockDirection
from src.services import account_resolver, audit_service, ledger_service, stock_service
from src.services.ledger_service import LineInput


class CouponError(Exception):
    pass


def _require_issued(coupon: Coupon) -> None:
    if coupon.status != CouponStatus.issued:
        raise CouponError(f"Coupon is {coupon.status.value}; only an issued coupon can be redeemed.")


def _receivable_account_id(db: Session, customer_id: int) -> int:
    acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer_id))
    if acc is None:
        raise CouponError("Customer has no receivable account.")
    return acc.account_id


def _post_money_redemption(
    db: Session, *, coupon: Coupon, mode: RedemptionMode, sales_invoice_id: int | None,
    actor_user_id: int,
) -> CouponRedemption:
    """Money / gift-money-off: debit loyalty_expense, credit customer_receivable (one entry)."""
    value = to_money(coupon.value)
    receivable_id = _receivable_account_id(db, coupon.customer_id)
    expense = account_resolver.loyalty_expense_account(db)
    entry = ledger_service.post_entry(
        db, entry_type="coupon_redeem", actor_user_id=actor_user_id,
        lines=[
            LineInput(expense.id, Direction.debit, value),
            LineInput(receivable_id, Direction.credit, value),
        ],
        description=f"Coupon {coupon.serial} redeemed ({mode.value})",
    )
    red = CouponRedemption(
        coupon_id=coupon.id, mode=mode, value=value, customer_id=coupon.customer_id,
        sales_invoice_id=sales_invoice_id, ledger_entry_id=entry.id, actor_user_id=actor_user_id,
    )
    db.add(red)
    coupon.status = CouponStatus.redeemed
    db.flush()
    audit_service.record(db, action="coupon.redeem", actor_user_id=actor_user_id,
                         entity_type="coupon", entity_id=coupon.id, after={"mode": mode.value})
    return red


def redeem_money(db, *, coupon: Coupon, sales_invoice_id=None, actor_user_id: int) -> CouponRedemption:
    _require_issued(coupon)
    if coupon.kind != CouponKind.money:
        raise CouponError("Not a money coupon.")
    return _post_money_redemption(db, coupon=coupon, mode=RedemptionMode.money,
                                  sales_invoice_id=sales_invoice_id, actor_user_id=actor_user_id)


def redeem_gift_money_off(db, *, coupon: Coupon, sales_invoice_id=None, actor_user_id: int) -> CouponRedemption:
    _require_issued(coupon)
    if coupon.kind != CouponKind.gift:
        raise CouponError("Not a gift coupon.")
    return _post_money_redemption(db, coupon=coupon, mode=RedemptionMode.gift_money_off,
                                  sales_invoice_id=sales_invoice_id, actor_user_id=actor_user_id)


def redeem_gift_product(
    db, *, coupon: Coupon, item_id: int, location_kind: LocationKind, location_id: int,
    quantity: Decimal, sales_invoice_id=None, actor_user_id: int,
) -> CouponRedemption:
    """Gift-as-product: stock-only (no ledger). Product value = sale_price × qty ≤ coupon value (A1)."""
    _require_issued(coupon)
    if coupon.kind != CouponKind.gift:
        raise CouponError("Not a gift coupon.")
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.product:
        raise CouponError("Gift product must be a product.")
    product_value = to_money(Decimal(quantity) * to_money(item.sale_price))
    if product_value > to_money(coupon.value):
        raise CouponError("Product value exceeds the coupon value.")
    mv = stock_service.post_movement(
        db, item_id=item_id, location_kind=location_kind, location_id=location_id,
        movement_type="loyalty_gift_out", direction=StockDirection.out, quantity=Decimal(quantity),
        actor_user_id=actor_user_id, source_doc_type="coupon", source_doc_id=coupon.id,
    )
    red = CouponRedemption(
        coupon_id=coupon.id, mode=RedemptionMode.gift_product, value=product_value,
        customer_id=coupon.customer_id, sales_invoice_id=sales_invoice_id, item_id=item_id,
        location_kind=location_kind, location_id=location_id, quantity=to_money(quantity),
        stock_movement_id=mv.id, actor_user_id=actor_user_id,
    )
    db.add(red)
    coupon.status = CouponStatus.redeemed
    db.flush()
    audit_service.record(db, action="coupon.redeem", actor_user_id=actor_user_id,
                         entity_type="coupon", entity_id=coupon.id, after={"mode": "gift_product"})
    return red


def reverse_redemption(db, *, coupon: Coupon, actor_user_id: int) -> CouponRedemption:
    """Reverse a coupon's active redemption: mirror ledger/stock; coupon → issued; reverse-once."""
    if coupon.status != CouponStatus.redeemed:
        raise CouponError("Coupon is not redeemed.")
    original = db.scalar(
        select(CouponRedemption).where(
            CouponRedemption.coupon_id == coupon.id,
            CouponRedemption.reverses_redemption_id.is_(None),
        ).order_by(CouponRedemption.id.desc())
    )
    if original is None:
        raise CouponError("No redemption to reverse.")
    if db.scalar(select(CouponRedemption).where(
        CouponRedemption.reverses_redemption_id == original.id
    )) is not None:
        raise CouponError("Redemption already reversed.")

    rev = CouponRedemption(
        coupon_id=coupon.id, mode=original.mode, value=original.value,
        customer_id=coupon.customer_id, reverses_redemption_id=original.id,
        actor_user_id=actor_user_id,
    )
    if original.mode in (RedemptionMode.money, RedemptionMode.gift_money_off):
        receivable_id = _receivable_account_id(db, coupon.customer_id)
        expense = account_resolver.loyalty_expense_account(db)
        entry = ledger_service.post_entry(
            db, entry_type="coupon_redeem_reverse", actor_user_id=actor_user_id,
            lines=[
                LineInput(receivable_id, Direction.debit, to_money(original.value)),
                LineInput(expense.id, Direction.credit, to_money(original.value)),
            ],
            description=f"Reverse redemption of coupon {coupon.serial}",
        )
        rev.ledger_entry_id = entry.id
    else:  # gift_product — reverse the stock movement (002 service)
        mirror = stock_service.reverse_movement(
            db, original_id=original.stock_movement_id, actor_user_id=actor_user_id)
        rev.stock_movement_id = mirror.id
    db.add(rev)
    coupon.status = CouponStatus.issued
    db.flush()
    audit_service.record(db, action="coupon.reverse", actor_user_id=actor_user_id,
                         entity_type="coupon", entity_id=coupon.id)
    return rev
