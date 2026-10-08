from __future__ import annotations

from decimal import Decimal

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from src.models.catalog import (
    BatchMovementKind,
    ItemSerial,
    ItemSerialMovement,
    SerialStatus,
    StockBatch,
    StockBatchMovement,
)
from src.models.ledger import LedgerEntry, LedgerLine
from src.models.loyalty import Coupon, CouponRedemption, PointRecord
from src.models.purchasing import (
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.reservation import Reservation
from src.models.sales import (
    SalesInvoice,
    SalesInvoiceCoupon,
    SalesInvoiceLine,
    SalesReturn,
    SalesReturnLine,
)
from src.models.sales_expense import SalesInvoiceExpense
from src.models.stock import StockDoc, StockMovement
from src.lib import stock_docs
from src.services.audit_service import record as audit_record
from src.core.money import to_qty

ZERO_QTY = to_qty(0)


class DocumentEditError(Exception):
    pass


def _drop_points(db: Session, *, sales_invoice_id: int | None = None,
                 sales_return_id: int | None = None) -> None:
    if sales_invoice_id is not None:
        earns = db.scalars(select(PointRecord.id).where(
            PointRecord.sales_invoice_id == sales_invoice_id)).all()
        if earns:
            db.execute(delete(PointRecord).where(PointRecord.origin_earn_id.in_(earns)))
        db.execute(delete(PointRecord).where(
            PointRecord.sales_invoice_id == sales_invoice_id))
    if sales_return_id is not None:
        db.execute(delete(PointRecord).where(
            PointRecord.sales_return_id == sales_return_id))


def _restore_serials(db: Session, *, sold_invoice_id: int | None = None,
                     document_type: str | None = None,
                     document_id: int | None = None) -> None:
    if sold_invoice_id is not None:
        rows = db.scalars(select(ItemSerial).where(
            ItemSerial.sold_invoice_id == sold_invoice_id)).all()
        for row in rows:
            row.status = SerialStatus.in_stock
            row.sold_invoice_id = None
    if document_type is not None and document_id is not None:
        db.execute(delete(ItemSerialMovement).where(
            ItemSerialMovement.document_type == document_type,
            ItemSerialMovement.document_id == document_id))


def _restore_batches(db: Session, *, document_type: str, document_id: int) -> None:
    rows = db.scalars(select(StockBatchMovement).where(
        StockBatchMovement.document_type == document_type,
        StockBatchMovement.document_id == document_id)).all()
    for mv in rows:
        batch = db.scalar(select(StockBatch).where(
            StockBatch.item_id == mv.item_id,
            StockBatch.location_kind == mv.location_kind,
            StockBatch.location_id == mv.location_id,
            StockBatch.expiry_date == mv.expiry_date))
        if batch is None:
            continue
        q = to_qty(mv.quantity)
        if mv.kind in (BatchMovementKind.consumed,):
            batch.quantity = to_qty(to_qty(batch.quantity) + q)
        elif mv.kind in (BatchMovementKind.received, BatchMovementKind.returned):
            batch.quantity = to_qty(to_qty(batch.quantity) - q)
    db.execute(delete(StockBatchMovement).where(
        StockBatchMovement.document_type == document_type,
        StockBatchMovement.document_id == document_id))


def _drop_stock(db: Session, *, source_doc_type: str, source_doc_id: int) -> None:
    db.execute(delete(StockMovement).where(
        StockMovement.source_doc_type.in_(stock_docs.names(source_doc_type)),
        StockMovement.source_doc_id == source_doc_id))


def _drop_entry(db: Session, entry_id: int | None) -> None:
    if entry_id is None:
        return
    from src.services import secure_hash_service

    entry = db.get(LedgerEntry, entry_id)
    if entry is not None:
        try:
            secure_hash_service.assert_alterable(entry)
        except secure_hash_service.HashChainError as exc:
            raise DocumentEditError(str(exc)) from exc

    reversals = db.scalars(select(LedgerEntry.id).where(
        LedgerEntry.reverses_entry_id == entry_id)).all()
    ids = [entry_id, *reversals]

    from src.services import reconcile_service

    from src.models.reconcile import PartialReconcile

    line_ids = [i for (i,) in db.execute(
        select(LedgerLine.id).where(LedgerLine.entry_id.in_(ids))).all()]
    if line_ids and db.scalar(
        select(PartialReconcile.id).where(
            PartialReconcile.debit_line_id.in_(line_ids)
            | PartialReconcile.credit_line_id.in_(line_ids)
        ).limit(1)
    ):
        reconcile_service.unreconcile(db, line_ids=line_ids)

    db.execute(delete(LedgerLine).where(LedgerLine.entry_id.in_(ids)))
    db.execute(delete(LedgerEntry).where(LedgerEntry.id.in_(ids)))


def frozen_costs(db: Session, invoice: SalesInvoice) -> dict[int, Decimal]:
    out: dict[int, Decimal] = {}
    for ln in invoice.lines:
        if ln.unit_cost is None:
            continue
        factor = Decimal(str(ln.unit_factor or 1)) or Decimal("1")
        out[ln.item_id] = Decimal(str(ln.unit_cost)) / factor
    return out


def purge_sale(db: Session, invoice: SalesInvoice, *, dropping: bool = False) -> None:
    from src.services import coupon_custody_service

    coupon_custody_service.release_for_invoice(db, invoice)
    _drop_points(db, sales_invoice_id=invoice.id)
    _restore_serials(db, sold_invoice_id=invoice.id,
                     document_type=StockDoc.SALE, document_id=invoice.id)
    _restore_batches(db, document_type=StockDoc.SALE, document_id=invoice.id)
    _drop_stock(db, source_doc_type=StockDoc.SALE, source_doc_id=invoice.id)
    entry_id = invoice.ledger_entry_id
    invoice.ledger_entry_id = None
    db.execute(delete(SalesInvoiceExpense).where(
        SalesInvoiceExpense.invoice_id == invoice.id))
    db.execute(delete(SalesInvoiceLine).where(
        SalesInvoiceLine.invoice_id == invoice.id))
    db.execute(delete(SalesInvoiceCoupon).where(
        SalesInvoiceCoupon.invoice_id == invoice.id))
    if dropping:
        db.execute(delete(CouponReceiptLine).where(
            CouponReceiptLine.sales_invoice_id == invoice.id))
        db.execute(update(CouponRedemption).where(
            CouponRedemption.sales_invoice_id == invoice.id).values(sales_invoice_id=None))
        db.execute(update(Reservation).where(
            Reservation.sales_invoice_id == invoice.id).values(sales_invoice_id=None))
    db.flush()
    _drop_entry(db, entry_id)


def assert_sale_editable(db: Session, invoice: SalesInvoice) -> None:
    returns = db.scalars(select(SalesReturn).where(
        SalesReturn.sales_invoice_id == invoice.id)).all()
    if returns:
        nums = "، ".join(r.document_number for r in returns[:3])
        raise DocumentEditError(
            f"على هذه الفاتورة مرتجع ({nums}) — احذف المرتجع أولاً ثم عدّل الفاتورة.")


def delete_sale(db: Session, *, invoice_id: int, actor_user_id: int) -> None:
    invoice = db.get(SalesInvoice, invoice_id)
    if invoice is None:
        raise DocumentEditError("فاتورة البيع غير موجودة.")
    returns = db.scalars(select(SalesReturn).where(
        SalesReturn.sales_invoice_id == invoice.id)).all()
    for ret in returns:
        ret_doc = ret.document_number
        purge_sales_return(db, ret)
        db.delete(ret)
        db.flush()
        audit_record(db, action="sales_return.delete", actor_user_id=actor_user_id,
                     entity_type="sales_return", entity_id=ret.id,
                     before={"doc": ret_doc, "cascade_from_invoice": invoice.document_number})
    db.flush()
    doc = invoice.document_number
    purge_sale(db, invoice, dropping=True)
    db.delete(invoice)
    db.flush()
    audit_record(db, action="sale.delete", actor_user_id=actor_user_id,
                 entity_type="sales_invoice", entity_id=invoice_id,
                 before={"doc": doc})


def delete_voucher(db: Session, *, voucher_id: int, actor_user_id: int) -> None:
    from src.models.voucher import Voucher

    voucher = db.get(Voucher, voucher_id)
    if voucher is None:
        raise DocumentEditError("السند غير موجود.")
    doc = voucher.document_number

    mirrors = db.scalars(select(Voucher).where(Voucher.reverses_id == voucher_id)).all()
    for m in mirrors:
        m_entry = m.ledger_entry_id
        m.ledger_entry_id = None
        db.flush()
        _drop_entry(db, m_entry)
        db.delete(m)
    db.flush()

    v_entry = voucher.ledger_entry_id
    voucher.ledger_entry_id = None
    db.flush()
    _drop_entry(db, v_entry)
    db.delete(voucher)
    db.flush()
    audit_record(db, action="voucher.delete", actor_user_id=actor_user_id,
                 entity_type="voucher", entity_id=voucher_id, before={"doc": doc})


def _resell_serials(db: Session, *, document_type: str, document_id: int,
                    invoice_id: int | None) -> None:
    rows = db.scalars(select(ItemSerialMovement).where(
        ItemSerialMovement.document_type == document_type,
        ItemSerialMovement.document_id == document_id)).all()
    for mv in rows:
        serial = db.get(ItemSerial, mv.serial_id)
        if serial is None:
            continue
        serial.status = SerialStatus.sold
        serial.sold_invoice_id = invoice_id
    db.execute(delete(ItemSerialMovement).where(
        ItemSerialMovement.document_type == document_type,
        ItemSerialMovement.document_id == document_id))


def purge_sales_return(db: Session, ret: SalesReturn) -> None:
    _drop_points(db, sales_return_id=ret.id)
    _resell_serials(db, document_type=StockDoc.SALE_RETURN, document_id=ret.id,
                    invoice_id=ret.sales_invoice_id)
    _restore_batches(db, document_type=StockDoc.SALE_RETURN, document_id=ret.id)
    _drop_stock(db, source_doc_type=StockDoc.SALE_RETURN, source_doc_id=ret.id)
    entry_id = ret.ledger_entry_id
    ret.ledger_entry_id = None
    db.execute(delete(SalesReturnLine).where(SalesReturnLine.return_id == ret.id))
    db.flush()
    _drop_entry(db, entry_id)


def delete_sales_return(db: Session, *, return_id: int, actor_user_id: int) -> None:
    ret = db.get(SalesReturn, return_id)
    if ret is None:
        raise DocumentEditError("المرتجع غير موجود.")
    doc = ret.document_number
    purge_sales_return(db, ret)
    db.delete(ret)
    db.flush()
    audit_record(db, action="sale_return.delete", actor_user_id=actor_user_id,
                 entity_type="sales_return", entity_id=return_id, before={"doc": doc})


def purge_purchase_return(db: Session, ret: PurchaseReturn) -> None:
    _restore_batches(db, document_type=StockDoc.PURCHASE_RETURN, document_id=ret.id)
    _drop_stock(db, source_doc_type=StockDoc.PURCHASE_RETURN, source_doc_id=ret.id)
    entry_id = ret.ledger_entry_id
    ret.ledger_entry_id = None
    db.execute(delete(PurchaseReturnLine).where(PurchaseReturnLine.return_id == ret.id))
    db.flush()
    _drop_entry(db, entry_id)


def delete_purchase_return(db: Session, *, return_id: int, actor_user_id: int) -> None:
    ret = db.get(PurchaseReturn, return_id)
    if ret is None:
        raise DocumentEditError("المردود غير موجود.")
    doc = ret.document_number
    purge_purchase_return(db, ret)
    db.delete(ret)
    db.flush()
    audit_record(db, action="purchase_return.delete", actor_user_id=actor_user_id,
                 entity_type="purchase_return", entity_id=return_id, before={"doc": doc})


def purge_purchase(db: Session, invoice: PurchaseInvoice) -> None:
    _restore_serials(db, document_type=StockDoc.PURCHASE, document_id=invoice.id)
    _restore_batches(db, document_type=StockDoc.PURCHASE, document_id=invoice.id)
    _drop_stock(db, source_doc_type=StockDoc.PURCHASE, source_doc_id=invoice.id)
    entry_id = invoice.ledger_entry_id
    invoice.ledger_entry_id = None
    db.execute(delete(PurchaseInvoiceLine).where(
        PurchaseInvoiceLine.invoice_id == invoice.id))
    db.flush()
    _drop_entry(db, entry_id)


def assert_purchase_editable(db: Session, invoice: PurchaseInvoice) -> None:
    returns = db.scalars(select(PurchaseReturn).where(
        PurchaseReturn.purchase_invoice_id == invoice.id)).all()
    if returns:
        nums = "، ".join(r.document_number for r in returns[:3])
        raise DocumentEditError(
            f"على هذه الفاتورة مردود ({nums}) — احذف المردود أولاً ثم عدّل الفاتورة.")


def delete_purchase(db: Session, *, purchase_id: int, actor_user_id: int) -> None:
    invoice = db.get(PurchaseInvoice, purchase_id)
    if invoice is None:
        raise DocumentEditError("فاتورة الشراء غير موجودة.")
    assert_purchase_editable(db, invoice)
    doc = invoice.document_number
    purge_purchase(db, invoice)
    db.delete(invoice)
    db.flush()
    audit_record(db, action="purchase.delete", actor_user_id=actor_user_id,
                 entity_type="purchase_invoice", entity_id=purchase_id,
                 before={"doc": doc})
