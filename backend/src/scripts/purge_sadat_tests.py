"""تنضيف شغل التجريب من فرع (السادات افتراضياً) — وكل اللي من a5 بيفضل زي ما هو.

    python -m src.scripts.purge_sadat_tests                       # عرض بس — مابيكتبش حاجة
    python -m src.scripts.purge_sadat_tests --yes                 # ينفّذ
    python -m src.scripts.purge_sadat_tests --branch السادات --prefix FC- --yes

---------------------------------------------------------------------------
**ليه.** المستخدم جرّب أوامر التشغيل على داتا السادات الحقيقية (حساب `manager3` ومدير
النظام): خامات اتصرفت من مخازن المصنع وتام دخل، والأرصدة بقت مختلفة عن a5. التجريب
مكانه التجريبي — والورق ده لازم يتشال قبل المزامنة الجاية.

**الفرز بالأصل مش بالتاريخ.** كل اللي جه من a5 عليه علامة: رقم المستند ببادئة الفرع
(`FC-S…`, `FC-T…`, `FC-RC…`) أو `imported_from = 'a5'` على أمر التشغيل. أي حاجة في
الفرع **من غير** العلامة دي اتكتبت في نظامنا — ودي اللي بتتعرض هنا. المسح بالتاريخ
كان هيشيل أي حاجة حقيقية اتكتبت في نفس الفترة، والعرض الأول موجود عشان ده يبان.

**المسح من الخدمات، مش SQL خام:**

    أمر التشغيل     manufacturing_production_service.purge_order
    فاتورة بيع      document_edit_service.delete_sale        (بمرتجعاتها)
    مرتجع بيع       document_edit_service.delete_sales_return
    فاتورة شراء     document_edit_service.delete_purchase    (بعد مردوداتها)
    مردود شراء      document_edit_service.delete_purchase_return
    إذن تحويل       transfer_service.delete
    سند             document_edit_service.delete_voucher
    مسودة           صف `document_draft` (مالهاش أثر — نفس `DELETE /drafts/{id}`)

الأذون والجرد والهالك والقيود اليدوية **مالهاش مسح حقيقي في الخدمات** (عكس بس). لو
لقى منهم حاجة من غير علامة a5، بيعرضها وبيرفض التنفيذ كله — القرار فيها مايتاخدش في
الضهر.

⛔ **مابيلمسش a5 خالص** (لا قواعده ولا ملفاته) — بيقرا ويكتب على Postgres بتاعنا بس.
وكل حاجة في ترانزاكشن واحدة: أي غلطة في النص بترجّع الكل.
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import or_, select

from src.core.db import SessionLocal
from src.models.draft import DocumentDraft
from src.models.manufacturing import ProductionOrder
from src.models.org import Branch
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.stock import LocationKind
from src.models.stock_count import StockCount
from src.models.stock_permit import StockPermit
from src.models.transfer import StockTransfer
from src.models.user import User
from src.models.voucher import Voucher
from src.models.warehouse import Warehouse
from src.models.wastage import WastageDocument


def _not_a5(col, prefix: str):
    return or_(col.is_(None), ~col.like(f"{prefix}%"))


def _fmt(row, user_names: dict[int, str], date_attr: str | None = None) -> str:
    who = user_names.get(getattr(row, "actor_user_id", None) or getattr(row, "initiated_by", None),
                         "?")
    when = getattr(row, "created_at", None)
    day = getattr(row, date_attr, None) if date_attr else None
    state = getattr(row, "state", None) or getattr(row, "status", None)
    state = getattr(state, "value", state)
    return (f"#{row.id:<7} {row.document_number:<16} {str(day or ''):<11} "
            f"{str(state or ''):<12} {who:<12} {when:%Y-%m-%d %H:%M}" if when else
            f"#{row.id} {row.document_number}")


def collect(db, branch: Branch, prefix: str) -> dict[str, list]:
    whs = [w for (w,) in db.execute(select(Warehouse.id).where(Warehouse.branch_id == branch.id))]

    def touches(src_kind, src_id, dst_kind, dst_id):
        return or_((src_kind == LocationKind.warehouse) & src_id.in_(whs),
                   (dst_kind == LocationKind.warehouse) & dst_id.in_(whs))

    found: dict[str, list] = {}
    found["production_orders"] = db.scalars(select(ProductionOrder).where(
        ProductionOrder.branch_id == branch.id, ProductionOrder.imported_from.is_(None))
        .order_by(ProductionOrder.id)).all()
    found["sales_returns"] = db.scalars(select(SalesReturn).where(
        SalesReturn.branch_id == branch.id, _not_a5(SalesReturn.document_number, prefix))).all()
    found["sales_invoices"] = db.scalars(select(SalesInvoice).where(
        SalesInvoice.branch_id == branch.id, _not_a5(SalesInvoice.document_number, prefix))).all()
    found["purchase_returns"] = db.scalars(select(PurchaseReturn).where(
        PurchaseReturn.branch_id == branch.id,
        _not_a5(PurchaseReturn.document_number, prefix))).all()
    found["purchase_invoices"] = db.scalars(select(PurchaseInvoice).where(
        PurchaseInvoice.branch_id == branch.id,
        _not_a5(PurchaseInvoice.document_number, prefix))).all()
    found["transfers"] = db.scalars(select(StockTransfer).where(
        or_(StockTransfer.branch_id == branch.id,
            touches(StockTransfer.source_location_kind, StockTransfer.source_location_id,
                    StockTransfer.dest_location_kind, StockTransfer.dest_location_id)),
        _not_a5(StockTransfer.document_number, prefix))).all()
    found["vouchers"] = db.scalars(select(Voucher).where(
        Voucher.branch_id == branch.id, _not_a5(Voucher.document_number, prefix))).all()
    found["drafts"] = db.scalars(select(DocumentDraft).where(
        DocumentDraft.branch_id == branch.id)).all()
    # من غير مسح في الخدمات — بتتعرض وبتوقف التنفيذ لو فيه منها.
    found["BLOCK_permits"] = db.scalars(select(StockPermit).where(
        StockPermit.warehouse_id.in_(whs), _not_a5(StockPermit.document_number, prefix))).all()
    found["BLOCK_stock_counts"] = db.scalars(select(StockCount).where(
        StockCount.warehouse_id.in_(whs))).all()
    found["BLOCK_wastage"] = db.scalars(select(WastageDocument).where(
        WastageDocument.warehouse_id.in_(whs))).all()
    return found


def _guard_not_a5(doc_number: str | None, prefix: str) -> None:
    if doc_number and doc_number.startswith(prefix):
        raise SystemExit(f"⛔ {doc_number} عليه بادئة a5 — وقف. ده مايتمسحش من هنا.")


def run(*, branch_name: str, prefix: str, execute: bool) -> None:
    from src.services import document_edit_service as des
    from src.services import manufacturing_production_service as mps
    from src.services import transfer_service

    db = SessionLocal()
    try:
        branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه {branch_name}")
        admin = db.scalars(select(User).order_by(User.id)).first()
        names = {u.id: u.username for u in db.scalars(select(User)).all()}
        found = collect(db, branch, prefix)

        print(f"الفرع: {branch.name} (#{branch.id}) · بادئة a5: {prefix}\n")
        total = 0
        for key, rows in found.items():
            print(f"{key:<20} {len(rows):>5}")
            for r in rows:
                if key == "drafts":
                    print(f"      draft #{r.id} {r.kind} {names.get(r.user_id, '?')} "
                          f"{r.updated_at:%Y-%m-%d %H:%M}")
                else:
                    date_attr = next((a for a in ("production_date", "invoice_date",
                                                  "return_date", "purchase_date",
                                                  "transfer_date", "voucher_date",
                                                  "permit_date", "count_date")
                                      if hasattr(r, a)), None)
                    print("      " + _fmt(r, names, date_attr))
            total += len(rows)
        blocked = {k: v for k, v in found.items() if k.startswith("BLOCK_") and v}
        if not total:
            print("\nمافيش حاجة تتشال.")
            return
        if blocked:
            print("\n⛔ فيه مستندات مالهاش مسح في الخدمات (" + "، ".join(blocked) + ").")
            print("   مافيش حاجة اتكتبت. القرار فيها يتاخد الأول.")
            return
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        actor = admin.id
        done: list[str] = []
        # الأوامر العكسية الأول، وبعدين أصولها — الاتنين في القايمة (قرار المستخدم ٢٠٢٦-١٠-٠٤).
        ids = {po.id for po in found["production_orders"]}
        for po in found["production_orders"]:
            if po.reverses_id is not None and po.reverses_id not in ids:
                raise SystemExit(f"{po.document_number} عكس لأمر مش في القايمة — وقفت.")
        for po in sorted(found["production_orders"], key=lambda o: o.reverses_id is None):
            if po.imported_from is not None:
                raise SystemExit(f"⛔ {po.document_number} منقول من a5 — وقف.")
            done.append(mps.purge_order(db, order_id=po.id, actor_user_id=actor, pair_ok=True))
        for r in found["sales_returns"]:
            _guard_not_a5(r.document_number, prefix)
            if db.get(SalesReturn, r.id) is not None:
                des.delete_sales_return(db, return_id=r.id, actor_user_id=actor)
                done.append(r.document_number)
        for r in found["sales_invoices"]:
            _guard_not_a5(r.document_number, prefix)
            des.delete_sale(db, invoice_id=r.id, actor_user_id=actor)
            done.append(r.document_number)
        for r in found["purchase_returns"]:
            _guard_not_a5(r.document_number, prefix)
            des.delete_purchase_return(db, return_id=r.id, actor_user_id=actor)
            done.append(r.document_number)
        for r in found["purchase_invoices"]:
            _guard_not_a5(r.document_number, prefix)
            des.delete_purchase(db, purchase_id=r.id, actor_user_id=actor)
            done.append(r.document_number)
        for r in found["transfers"]:
            _guard_not_a5(r.document_number, prefix)
            transfer_service.delete(db, transfer_id=r.id, actor_user_id=actor)
            done.append(r.document_number)
        for r in found["vouchers"]:
            _guard_not_a5(r.document_number, prefix)
            if db.get(Voucher, r.id) is not None:
                des.delete_voucher(db, voucher_id=r.id, actor_user_id=actor)
                done.append(r.document_number)
        for d in found["drafts"]:
            db.delete(d)
        db.flush()

        # التحقق قبل الـcommit: نفس الفرز لازم يرجع فاضي.
        again = collect(db, branch, prefix)
        left = {k: len(v) for k, v in again.items() if v}
        if left:
            raise SystemExit(f"⛔ لسه فيه بعد المسح: {left} — اترجع كله.")
        db.commit()
        print(f"\nاتشال {len(done)} مستند و{len(found['drafts'])} مسودة:")
        print("   " + "، ".join(done))
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", default="السادات")
    ap.add_argument("--prefix", default="FC-", help="بادئة مستندات a5 للفرع ده")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args(sys.argv[1:])
    run(branch_name=a.branch, prefix=a.prefix, execute=a.yes)
