"""فواتير الـ٩٩٫٩٩٪ — بتتحوّل بونص ١٠٠٪ زي ما اللي كتبها كان قاصد.

    python -m src.scripts.fix_near_full_discount_bonus
    python -m src.scripts.fix_near_full_discount_bonus --yes

---------------------------------------------------------------------------
الشاشة كانت بترفض خصم ١٠٠٪ قبل ما «خصم ١٠٠٪ = بونص» يشتغل صح، فالمناديب والمكتب كتبوا
٩٩٫٩٩ أو ٩٩٫٩ عشان الهدية تعدّي. النتيجة فاتورة بيع بصافي قروش (٠٫٠٦ … ٢٫٥٦ ج.م) —
بتدخل مديونية العميل وإجماليات المبيعات، وماتظهرش في البونص.

**التصحيح بنفس طريق «تعديل» الفاتورة** (`update_sale`): الأثر القديم بيتشال (القيد
والمخزون) والفاتورة بتتبني تاني مكانها بونص ١٠٠٪ — نفس الرقم، ونفس السطور والكميات
والمخازن، ونفس التكلفة المجمّدة. يعني القيد والمديونية والمخزون بيتظبطوا مع بعض، مش رقم
بيتكتب فوق رقم.

**الربط بفاتورة البيع** بنفس قاعدة `mark_bonus_invoices`: فاتورة بيع واحدة بالظبط لنفس
العميل في نفس اليوم. أكتر من واحدة أو مافيش ⇒ بونص من غير ربط، والمكتب يربطه من الشاشة —
التخمين بيربط هدية بفاتورة غلط.

بيتخطّى: الفاتورة اللي عليها مرتجع أو مصروفات أو توزيع مراكز تكلفة (التعديل مش هيرجّعهم
زي ما هم)، وأي خصم مش بين ٩٩ و١٠٠. بيتعاد بأمان — اللي اتحوّل بقى ١٠٠ فمابيتلقطش تاني.
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import or_, select

from src.api.sales import (
    InvoiceCouponIn, LocationIn, SaleCreate, SaleLineIn, _build_sale,
)
from src.auth.dependencies import CurrentUser
from src.core.db import SessionLocal
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice, SalesInvoiceCoupon
from src.models.sales_expense import SalesInvoiceExpense
from src.models.user import User
from src.services import document_edit_service
from src.services.document_edit_service import DocumentEditError
from src.services.sales_service import SalesError


def _near_full(pct) -> bool:
    return pct is not None and Decimal("99") <= Decimal(pct) < Decimal("100")


def _candidates(db, inv: SalesInvoice) -> list[int]:
    return db.scalars(select(SalesInvoice.id).where(
        SalesInvoice.customer_id == inv.customer_id,
        SalesInvoice.invoice_date == inv.invoice_date,
        SalesInvoice.id != inv.id,
        SalesInvoice.combined_pct < 99,
        or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
    )).all()


def _body(db, inv: SalesInvoice, bonus_for: int | None) -> SaleCreate:
    coupons = db.scalars(select(SalesInvoiceCoupon).where(
        SalesInvoiceCoupon.invoice_id == inv.id)).all()
    return SaleCreate(
        customer_id=inv.customer_id,
        origin=LocationIn(location_kind=inv.origin_location_kind,
                          location_id=inv.origin_location_id),
        variable_discount_pct=Decimal("0"),
        cash_amount=Decimal("0"),
        lines=[SaleLineIn(
            item_id=ln.item_id, quantity=ln.quantity, tier=ln.price_tier,
            unit_price=ln.unit_price, unit=ln.unit,
            fixed_discount_pct=Decimal("0"), variable_discount_pct=Decimal("0"),
            warehouse_id=ln.location_id,
        ) for ln in inv.lines],
        rep_id=inv.rep_id, revenue_account_id=inv.revenue_account_id,
        external_document_number=inv.external_document_number, notes=inv.notes,
        cost_center_id=inv.cost_center_id,
        statement1=inv.statement1, statement2=inv.statement2, statement3=inv.statement3,
        coupon_serial_from=inv.coupon_serial_from, coupon_serial_to=inv.coupon_serial_to,
        coupon_count=inv.coupon_count,
        coupons=[InvoiceCouponIn(coupon_kind=c.coupon_kind, coupon_type_id=c.coupon_type_id,
                                 count=c.count, serial_from=c.serial_from,
                                 serial_to=c.serial_to) for c in coupons],
        invoice_date=inv.invoice_date,
        prior_balance=inv.prior_balance, other_family_balance=inv.other_family_balance,
        other_family=inv.other_family, family=inv.family,
        is_bonus=True, bonus_for_invoice_id=bonus_for,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="نفّذ (من غيرها عرض بس)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        # بيتنفّذ باسم المالك: التصحيح مش شغل مندوب، ونطاق الفرع والعميل مايوقفوهوش.
        owner = db.scalar(select(User).join(Role, Role.id == User.role_id).where(
            Role.name == RoleName.owner, User.active.is_(True)).order_by(User.id))
        current = CurrentUser(id=owner.id, username=owner.username, role=RoleName.owner,
                              branch_id=None, territory_id=None)
        todo = [inv for inv in db.scalars(select(SalesInvoice).where(
            or_(SalesInvoice.is_bonus.is_(None), SalesInvoice.is_bonus.is_(False)),
            SalesInvoice.combined_pct >= 99, SalesInvoice.combined_pct < 100,
        ).order_by(SalesInvoice.id)).all()]
        print(f"فواتير خصمها بين ٩٩ و١٠٠٪: {len(todo)}\n")

        done = 0
        for inv in todo:
            label = f"{inv.document_number} ({inv.invoice_date}) صافي {inv.net}"
            if db.scalar(select(SalesInvoiceExpense.id).where(
                    SalesInvoiceExpense.invoice_id == inv.id).limit(1)):
                print(f"   ⏭ {label}: عليها مصروفات — اتسابت")
                continue
            cands = _candidates(db, inv)
            bonus_for = cands[0] if len(cands) == 1 else None
            link = (db.get(SalesInvoice, bonus_for).document_number if bonus_for
                    else f"من غير ربط ({len(cands)} فاتورة في نفس اليوم)")
            sp = db.begin_nested()
            try:
                document_edit_service.assert_sale_editable(db, inv)
                kept = document_edit_service.frozen_costs(db, inv)
                body = _body(db, inv, bonus_for)
                document_edit_service.purge_sale(db, inv)
                new = _build_sale(db, body, current, replace_invoice_id=inv.id,
                                  keep_costs=kept, allow_unlinked_bonus=True)
                sp.commit()
            except (DocumentEditError, SalesError, Exception) as exc:  # noqa: BLE001
                sp.rollback()
                print(f"   ✗ {label}: {getattr(exc, 'detail', exc)}")
                continue
            done += 1
            print(f"   ✓ {label} ⇐ بونص، صافي {new.net} — {link}")

        if not args.yes:
            db.rollback()
            print(f"\n[عرض فقط] هيتحوّل {done}. مافيش حاجة اتغيّرت — ضيف --yes للتنفيذ.")
            return
        db.commit()
        print(f"\n   ✓ اتحوّل {done}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
