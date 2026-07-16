"""Point service (T010, +T014/T015/T023/T036 added per phase).

The point ledger is append-only; the customer balance is DERIVED as Σ delta and MAY be negative
(owed points). All writes go through `_post_record`; corrections are new linked records (Principle IV).
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.models.loyalty import (
    Coupon,
    CouponStatus,
    CouponType,
    PointConversion,
    PointKind,
    PointRecord,
    ProductPointValue,
)


class PointError(Exception):
    pass


def _points(value) -> Decimal:
    """Points are fractional (v4) — normalise to 3dp Decimal."""
    return Decimal(str(value or 0)).quantize(Decimal("0.001"))


def balance(db: Session, customer_id: int) -> Decimal:
    """Derived point balance = Σ delta over the customer's records (may be negative)."""
    total = db.scalar(
        select(func.coalesce(func.sum(PointRecord.delta), 0)).where(
            PointRecord.customer_id == customer_id
        )
    )
    return _points(total)


def _post_record(
    db: Session,
    *,
    customer_id: int,
    kind: PointKind,
    delta: int,
    sales_invoice_id: int | None = None,
    sales_return_id: int | None = None,
    origin_earn_id: int | None = None,
    conversion_id: int | None = None,
    coupon_id: int | None = None,
    actor_user_id: int | None = None,
) -> PointRecord:
    rec = PointRecord(
        customer_id=customer_id,
        kind=kind,
        delta=_points(delta),
        sales_invoice_id=sales_invoice_id,
        sales_return_id=sales_return_id,
        origin_earn_id=origin_earn_id,
        conversion_id=conversion_id,
        coupon_id=coupon_id,
        actor_user_id=actor_user_id,
    )
    db.add(rec)
    db.flush()
    return rec


def _point_value(db: Session, item_id: int) -> Decimal:
    """Current per-unit point value for a product; 0 if none set (G1 — graceful). Fractional (v4)."""
    ppv = db.scalar(select(ProductPointValue).where(ProductPointValue.item_id == item_id))
    return _points(ppv.point_value) if ppv else _points(0)


# --- Earning / reversal (T014/T015), driven by the 002 sale hooks ---

def earn_for_invoice(db: Session, invoice) -> PointRecord | None:
    """Earn Σ(point value × qty) for a sales invoice. No-op (returns None) if total is 0 (G1)."""
    total = _points(0)
    for line in invoice.lines:
        total += _point_value(db, line.item_id) * Decimal(str(line.quantity))
    total = _points(total)
    if total <= 0:
        return None
    return _post_record(
        db, customer_id=invoice.customer_id, kind=PointKind.earn, delta=total,
        sales_invoice_id=invoice.id,
    )


def _earn_record_for_invoice(db: Session, invoice_id: int) -> PointRecord | None:
    return db.scalar(
        select(PointRecord).where(
            PointRecord.sales_invoice_id == invoice_id, PointRecord.kind == PointKind.earn
        )
    )


def reverse_for_return(db: Session, sales_return, invoice) -> PointRecord | None:
    """Reverse points for the returned quantity (linked to the original earn). FR-004 base path."""
    r = _points(0)
    for line in sales_return.lines:
        r += _point_value(db, line.item_id) * Decimal(str(line.quantity))
    r = _points(r)
    if r <= 0:
        return None
    earn = _earn_record_for_invoice(db, invoice.id)
    return _post_record(
        db, customer_id=invoice.customer_id, kind=PointKind.reverse, delta=-r,
        sales_return_id=sales_return.id, origin_earn_id=earn.id if earn else None,
    )


def reconcile_return(db: Session, customer_id: int, sales_return_id: int) -> None:
    """Q3 hybrid (T036): if the reversal drove the balance negative because points were already
    consumed, void unredeemed coupons to reclaim points. Any residual negative is owed points from
    already-redeemed coupons and stands (settled against future earnings). Never blocks the return."""
    if balance(db, customer_id) >= 0:
        return
    issued = db.scalars(
        select(Coupon)
        .where(Coupon.customer_id == customer_id, Coupon.status == CouponStatus.issued)
        .order_by(Coupon.id.desc())
    ).all()
    for coupon in issued:
        if balance(db, customer_id) >= 0:
            break
        coupon.status = CouponStatus.voided
        db.flush()
        _post_record(
            db, customer_id=customer_id, kind=PointKind.void_reclaim,
            delta=_points(coupon.points_consumed), coupon_id=coupon.id,
            sales_return_id=sales_return_id,
        )


# --- Conversion (T023): whole coupons only ---

def _next_serial(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(Coupon)) or 0
    return f"CPN-{n + 1:08d}"


def convert(db: Session, *, customer_id: int, coupon_type_ids: list[int], actor_user_id: int) -> list[Coupon]:
    """Convert points into coupons (one per listed type). Whole coupons only; reject if a type's
    point cost exceeds the remaining available balance (FR-007/008)."""
    if not coupon_type_ids:
        raise PointError("Select at least one coupon type.")
    available = balance(db, customer_id)
    conversion = PointConversion(customer_id=customer_id, actor_user_id=actor_user_id)
    db.add(conversion)
    db.flush()
    coupons: list[Coupon] = []
    for type_id in coupon_type_ids:
        ct = db.get(CouponType, type_id)
        if ct is None or not ct.active:
            raise PointError("Coupon type not found or inactive.")
        cost = _points(ct.point_cost)
        if cost > available:
            raise PointError("Insufficient points for the selected coupon type.")
        available -= cost
        coupon = Coupon(
            serial=_next_serial(db), customer_id=customer_id, coupon_type_id=ct.id,
            kind=ct.kind, value=ct.value, points_consumed=int(ct.point_cost),
            status=CouponStatus.issued, conversion_id=conversion.id,
        )
        db.add(coupon)
        db.flush()
        _post_record(
            db, customer_id=customer_id, kind=PointKind.converted, delta=-cost,
            conversion_id=conversion.id, coupon_id=coupon.id, actor_user_id=actor_user_id,
        )
        coupons.append(coupon)
    return coupons
