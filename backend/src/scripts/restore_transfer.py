# -*- coding: utf-8 -*-
"""رجوع إذن تحويل اتلغى بالغلط — بيرجع معتمد وحركاته تتكتب تاني.

زرار «تعديل» على الإذن المعتمد كان بيلغيه من غير ما يسأل، فاللي ضغطه وهو فاكر إنه
هيعدّل لقى المستند ملغي والبضاعة رجعت. حصل مع TRF-000004: رجعت البضاعة للمخزن الرئيسي،
وصنفين في «مخزن السياره ( د )» بقى رصيدهم سالب لأنهم كانوا اتباعوا خلاص.

بيرجّع الإذن عن طريق `transfer_service.approve` نفسها — مش بكتابة حركات بالإيد — عشان
الحركات تطلع بنفس الشكل اللي الاعتماد العادي بيطلّعه، وترتبط بسطورها، والسيريالات
والدفعات تتحرك معاها. والمعتمد وتاريخ الاعتماد الأصليين بيترجعوا زي ما كانوا.

بيرفض لو الإذن مش ملغي أو مرفوض، ولو له حركات لسه موجودة — عشان مايتكتبش مرتين.

    python -m src.scripts.restore_transfer 2504            # عرض بس
    python -m src.scripts.restore_transfer 2504 --apply    # بيكتب
"""
from __future__ import annotations

import argparse
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.role import RoleName
from src.models.stock import StockDirection, StockMovement
from src.models.transfer import StockTransfer, StockTransferLine, TransferStatus
from src.services import transfer_service

REOPENABLE = {TransferStatus.reversed, TransferStatus.rejected}


def _balance(db: Session, item_id: int, kind, loc_id: int) -> Decimal:
    q = db.scalar(
        select(func.sum(case(
            (StockMovement.direction == StockDirection.in_, StockMovement.quantity),
            else_=-StockMovement.quantity)))
        .where(StockMovement.item_id == item_id,
               StockMovement.location_kind == kind,
               StockMovement.location_id == loc_id)
    )
    return Decimal(str(q or 0))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("transfer_id", type=int)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db: Session = SessionLocal()
    try:
        t = db.get(StockTransfer, args.transfer_id)
        if t is None:
            raise SystemExit("الإذن مش موجود.")
        if t.status not in REOPENABLE:
            raise SystemExit(f"الإذن حالته «{t.status.value}» — الملغي والمرفوض بس هما اللي يترجعوا.")
        left = db.scalar(select(func.count(StockMovement.id)).where(
            StockMovement.source_doc_type == transfer_service.MOVEMENT_DOC,
            StockMovement.source_doc_id == t.id))
        if left:
            raise SystemExit(f"الإذن لسه عليه {left} حركة — لو اترجّع هتتكتب مرتين.")

        lines = db.scalars(select(StockTransferLine).where(
            StockTransferLine.transfer_id == t.id)).all()
        names = {i.id: f"{i.code} — {i.name}" for i in db.scalars(
            select(Item).where(Item.id.in_([ln.item_id for ln in lines]))).all()}

        print(f"الإذن {t.document_number} | الحالة «{t.status.value}» | السبب: {t.reject_reason}")
        print(f"من {t.source_location_kind.value} #{t.source_location_id} "
              f"إلى {t.dest_location_kind.value} #{t.dest_location_id} | {len(lines)} سطر")
        print()
        print(f"{'الصنف':<34} {'كمية':>7} {'مصدر الآن':>10} {'←':>7} {'وجهة الآن':>10} {'←':>7}")
        for ln in lines:
            sb = _balance(db, ln.item_id, t.source_location_kind, t.source_location_id)
            dbal = _balance(db, ln.item_id, t.dest_location_kind, t.dest_location_id)
            q = Decimal(str(ln.quantity))
            print(f"{names.get(ln.item_id, ln.item_id)[:34]:<34} {q!s:>7} "
                  f"{sb!s:>10} {sb - q!s:>7} {dbal!s:>10} {dbal + q!s:>7}")

        if not args.apply:
            print()
            print("عرض بس — للكتابة زوّد --apply")
            return

        # الاعتماد بيشترط «معلّق»، والمعتمد وتاريخه بيترجعوا بعده زي ما كانوا: اللي
        # اعتمد الإذن أول مرة هو اللي اعتمده، مش اللي شغّل السكريبت.
        was_by, was_at = t.approved_by, t.approved_at
        actor = was_by or t.initiated_by
        t.status = TransferStatus.pending
        db.flush()
        # `is_admin=True`: الإذن ده **اتعتمد فعلاً** قبل كده من `approved_by`، فالصلاحية
        # اتفحصت وقتها. السكريبت بيرجّع قرار اتاخد، مش بياخد قرار جديد — وإعادة فحص
        # الصلاحية هنا هتوقف إرجاع إذن مديره اتنقل فرع من ساعتها.
        transfer_service.approve(
            db, transfer_id=t.id, approver_user_id=actor,
            approver_role=RoleName.system_admin, approver_branch_id=None, is_admin=True)
        t.approved_by, t.approved_at = was_by, was_at
        t.reject_reason = None
        db.commit()

        print()
        print(f"رجع: {t.document_number} حالته «{t.status.value}»")
        n = db.scalar(select(func.count(StockMovement.id)).where(
            StockMovement.source_doc_type == transfer_service.MOVEMENT_DOC,
            StockMovement.source_doc_id == t.id))
        print(f"حركات اتكتبت: {n}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
