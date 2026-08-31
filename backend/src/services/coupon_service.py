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

from src.core.money import to_money
from src.models.catalog import Item, ItemKind
from src.models.customer import CustomerAccount
from src.models.ledger import Direction, LedgerLine
from src.models.loyalty import (
    Coupon,
    CouponKind,
    CouponRedemption,
    CouponStatus,
    RedemptionMode,
)
from src.models.stock import LocationKind, StockDirection
from src.services import account_resolver, audit_service, ledger_service, stock_service
from src.services.customer_merge_service import MergeError
from src.services.ledger_service import LineInput


class CouponError(Exception):
    pass


def _require_issued(coupon: Coupon) -> None:
    if coupon.status != CouponStatus.issued:
        raise CouponError("الكوبون ده مش صالح للصرف — الكوبون المصروف للعميل بس هو اللي يتصرف.")


def _receivable_account(db: Session, customer_id: int) -> tuple[int, str | None]:
    """حساب ذمم العميل + بيان يتكتب على السطر لو الاختيار مااتسألش عنه.

    الكوبون بيتصرف على ذمة العميل (مدين مصروف ولاء، دائن الذمم)، فلازم يكون فيه حساب.
    بس «مالوش حساب» مش سبب يمنع الصرف — الكوبون في إيد العميل بالفعل. الفتح على نفس
    الـsession، فلو الصرف وقع بعد كده الحساب بيترجع معاه. ده اللي
    `customer_service.require_account` بيعمله.

    **والعميل المدموج ماينفعش يترفض هنا.** بعد `customer_merge_service.apply` العميل
    الباقي بيبقى عنده حسابين (أبيض + بولي) ومافيش فيهم واحد بـ`family=None`، فسؤال
    `require_account` من غير خط بيرجع `MergeError`. في البيع ده سؤال حقيقي — «نوع
    الفاتورة» مكتوب على المستند والبايع بيجاوب عليه. في الكوبون مافيش إجابة أصلاً:
    `Coupon` مالوش `family`، و`RedeemRequest` مافيهاش الحقل، فالرسالة بتطلب من
    المستخدم حاجة مافيش شاشة تقولها. والتجار — أصحاب الكوبونات — هما بالظبط اللي
    الدمج اتعمل عليهم.

    فبدل الرفض: أقدم حساب (`min(id)`) — وده حساب العميل الباقي نفسه، اللي الدمج سماه
    «أبيض» — والاختيار بيتكتب في بيان السطر عشان اللي بيراجع الدفتر يشوفه بدل ما
    يخمّنه.
    """
    from src.services import customer_service

    try:
        acc = customer_service.require_account(db, customer_id)
        return acc.account_id, None
    except MergeError:
        pass
    except customer_service.CustomerError as exc:
        raise CouponError(str(exc)) from exc

    rows = sorted(
        db.scalars(
            select(CustomerAccount).where(CustomerAccount.customer_id == customer_id)
        ).all(),
        key=lambda a: a.id,
    )
    if not rows:  # ما يوصلش — `require_account` بيفتح حساب للي مالوش
        raise CouponError("العميل ده مالوش حساب ذمم.")
    acc = rows[0]
    return acc.account_id, f"صرف كوبون على حساب «{acc.family or '—'}» (العميل عنده أكتر من حساب)"


def _original_receivable_account_id(db: Session, original: CouponRedemption) -> int | None:
    """الحساب اللي الصرف الأصلي نزل عليه — مقروء من قيده، مش بسؤال جديد.

    العكس مالوش أي حق يسأل تاني: القيد الأصلي عارف نزل على أنهي حساب، وأي إعادة حساب
    ممكن ترد بحساب تاني (أو ترفض) وتسيب صرف مقيّد مايتعكسش. الصرف بينزل سطرين — مدين
    مصروف ولاء، دائن الذمم — فسطر الدائن هو حساب العميل.
    """
    if original.ledger_entry_id is None:
        return None
    return db.scalar(
        select(LedgerLine.account_id)
        .where(
            LedgerLine.entry_id == original.ledger_entry_id,
            LedgerLine.direction == Direction.credit,
        )
        .order_by(LedgerLine.id)
    )


def _post_money_redemption(
    db: Session, *, coupon: Coupon, mode: RedemptionMode, sales_invoice_id: int | None,
    actor_user_id: int,
) -> CouponRedemption:
    """Money / gift-money-off: debit loyalty_expense, credit customer_receivable (one entry)."""
    value = to_money(coupon.value)
    receivable_id, note = _receivable_account(db, coupon.customer_id)
    expense = account_resolver.loyalty_expense_account(db)
    entry = ledger_service.post_entry(
        db, entry_type="coupon_redeem", actor_user_id=actor_user_id,
        lines=[
            LineInput(expense.id, Direction.debit, value),
            LineInput(receivable_id, Direction.credit, value, statement=note),
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
        raise CouponError("ده مش كوبون فلوس.")
    return _post_money_redemption(db, coupon=coupon, mode=RedemptionMode.money,
                                  sales_invoice_id=sales_invoice_id, actor_user_id=actor_user_id)


def redeem_gift_money_off(db, *, coupon: Coupon, sales_invoice_id=None, actor_user_id: int) -> CouponRedemption:
    _require_issued(coupon)
    if coupon.kind != CouponKind.gift:
        raise CouponError("ده مش كوبون هدية.")
    return _post_money_redemption(db, coupon=coupon, mode=RedemptionMode.gift_money_off,
                                  sales_invoice_id=sales_invoice_id, actor_user_id=actor_user_id)


def redeem_gift_product(
    db, *, coupon: Coupon, item_id: int, location_kind: LocationKind, location_id: int,
    quantity: Decimal, sales_invoice_id=None, actor_user_id: int,
) -> CouponRedemption:
    """Gift-as-product: stock-only (no ledger). Product value = sale_price × qty ≤ coupon value (A1)."""
    _require_issued(coupon)
    if coupon.kind != CouponKind.gift:
        raise CouponError("ده مش كوبون هدية.")
    item = db.get(Item, item_id)
    if item is None or item.kind != ItemKind.product:
        raise CouponError("هدية الكوبون لازم تكون منتج.")
    product_value = to_money(Decimal(quantity) * to_money(item.sale_price))
    if product_value > to_money(coupon.value):
        raise CouponError("قيمة المنتج أكبر من قيمة الكوبون.")
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
        raise CouponError("الكوبون ده مااتصرفش.")
    original = db.scalar(
        select(CouponRedemption).where(
            CouponRedemption.coupon_id == coupon.id,
            CouponRedemption.reverses_redemption_id.is_(None),
        ).order_by(CouponRedemption.id.desc())
    )
    if original is None:
        raise CouponError("مفيش صرف يتعكس.")
    if db.scalar(select(CouponRedemption).where(
        CouponRedemption.reverses_redemption_id == original.id
    )) is not None:
        raise CouponError("الصرف ده اتعكس قبل كده.")

    rev = CouponRedemption(
        coupon_id=coupon.id, mode=original.mode, value=original.value,
        customer_id=coupon.customer_id, reverses_redemption_id=original.id,
        actor_user_id=actor_user_id,
    )
    if original.mode in (RedemptionMode.money, RedemptionMode.gift_money_off):
        # الحساب من قيد الصرف نفسه. الرجوع لـ`_receivable_account` بس لو الصرف القديم
        # مالوش قيد أصلاً — ساعتها مافيش حاجة تُقرأ منها.
        receivable_id = _original_receivable_account_id(db, original)
        if receivable_id is None:
            receivable_id, _note = _receivable_account(db, coupon.customer_id)
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
