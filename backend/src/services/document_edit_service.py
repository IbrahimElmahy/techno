"""تعديل المستندات وحذفها — حر، من غير قيود عكسية ولا مرتجعات.

النظام كان بيتعامل مع كل مستند مرحّل على إنه حقيقة تاريخية مايتغيّرش: تعديل فاتورة كان
بيتعمل بإنها **تتعكس** — يتكتب مرتجع بأصنافها وقيد مضاد بمبلغها — وبعدين تتكتب فاتورة
جديدة. النتيجة إن تصليح غلطة في سعر بيسيب وراه ورق: مرتجع محدش رجّعه، وقيدين زياة في
كشف الحساب، ورصيد عميل بيعدّي بتلات مراحل عشان رقم اتغيّر.

ده أسلوب دفتر أستاذ محاسبي، وهو صح للنظام اللي بيتقفل بميزانية مدققة. الشركة دي مش
بتشتغل كده — عايزة الفاتورة تتفتح وتتعدّل وتتقفل، زي أي شاشة تانية.

فالتعديل هنا بيشتغل بطريقتين: **بيمسح أثر المستند القديم بالكامل**، وبعدين بيعيد إنشاءه
بالبيانات الجديدة **بنفس رقمه ونفس الـid**. اللي بيبص على النظام بعد التعديل بيلاقي
مستند واحد صح، مش تلاتة بيشرحوا بعض.

## ليه المسح مش تعويض

الحركة المخزنية والقيد ممنوع تعديلهم على مستوى الـORM (حراس `before_update`/`before_delete`
على `StockMovement` و`LedgerEntry` و`PointRecord`). الحراس دول بيمنعوا **التعديل بالغلط** —
كود بيعدّل صف كان المفروض يكتب صف جديد. المسح المتعمد هنا بيعدّي عن طريق `delete()` على
مستوى الـCore، اللي مابيشغّلش مابرات الـORM. وده مقصود: الفرق بين «الكود مايعدّلش حركة
مرحّلة وهو بيشتغل» و«المستخدم بيصلّح غلطة في المستند» فرق حقيقي، والتاني ليه طريق واحد
معروف — الملف ده.

## ترتيب المسح مهم

الأثر بيتشال بالعكس بالظبط: النقاط، فالسيريالات، فالدفعات، فالحركة المخزنية، فالقيد.
السيريالات والدفعات بيرجعوا لحالتهم الأولى **قبل** ما الحركة تتشال، عشان الحسابات اللي
بتعتمد على الرصيد (زي `on_hand`) تفضل متسقة أثناء العملية نفسها.
"""
from __future__ import annotations

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
from src.models.stock import StockMovement
from src.services.audit_service import record as audit_record
from src.core.money import to_qty

ZERO_QTY = to_qty(0)


class DocumentEditError(Exception):
    """المستند مش موجود، أو فيه حاجة متعلّقة بيه بتمنع تعديله."""


# ---------------------------------------------------------------- شيل الأثر

def _drop_points(db: Session, *, sales_invoice_id: int | None = None,
                 sales_return_id: int | None = None) -> None:
    """النقاط اللي المستند ده طلّعها أو شالها — وأي سطر مربوط بيها.

    سطر «العكس» بيشاور على سطر «الكسب» بـ`origin_earn_id`، فمسح الكسب لوحده بيسيب سطر
    يتيم بيشاور على حاجة مش موجودة.
    """
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
    """السيريالات ترجع مخزن، وسجل حركتها على المستند ده يتشال.

    السيريال بيتخزّن بحالته الحالية (مش بسجل حركات بيتجمع)، فرجوعه معناه إن الصف نفسه
    يرجع `in_stock` وينفصل عن الفاتورة.
    """
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
    """الدفعات ترجع لكميتها قبل المستند، وسطور حركتها تتشال.

    كل سطر بيقول اتاخد كام من دفعة إمتى، فالرجوع هو عكس كل سطر على دفعته: المستهلك
    بيترد، والمستلم بيتخصم. الدفعة اللي المستند ده هو اللي أنشأها بتفضل بصفر بدل ما
    تتمسح — الأصناف اللي ليها صلاحية بيتقاس عليها بتاريخها، ومسح صف الدفعة بيضيّع التاريخ
    ده من على أي حركة تانية اتعلّقت بيه.
    """
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
    """حركات المخزون بتاعة المستند — بتتشال خالص.

    الرصيد مشتق من الحركات (مافيش رصيد مخزّن)، فشيل الحركة بيرجّع الرصيد لوحده. وده
    السبب اللي بيخلي الطريقة دي ممكنة أصلاً.
    """
    db.execute(delete(StockMovement).where(
        StockMovement.source_doc_type == source_doc_type,
        StockMovement.source_doc_id == source_doc_id))


def _drop_entry(db: Session, entry_id: int | None) -> None:
    """القيد وسطوره — وأي قيد اتكتب عشان يعكسه.

    لو المستند كان اتعكس قبل كده، القيد المضاد لازم يروح معاه؛ سيبانه بيخلّي الحساب
    ناقص بمبلغ عملية مالهاش وجود.
    """
    if entry_id is None:
        return
    reversals = db.scalars(select(LedgerEntry.id).where(
        LedgerEntry.reverses_entry_id == entry_id)).all()
    ids = [entry_id, *reversals]
    db.execute(delete(LedgerLine).where(LedgerLine.entry_id.in_(ids)))
    db.execute(delete(LedgerEntry).where(LedgerEntry.id.in_(ids)))


# ---------------------------------------------------------------- فاتورة البيع

def purge_sale(db: Session, invoice: SalesInvoice, *, dropping: bool = False) -> None:
    """بيشيل كل أثر فاتورة بيع من النظام — من غير ما يمس الفاتورة نفسها.

    بيتنادى من التعديل (وبعده الفاتورة بتتبني من جديد) ومن الحذف (وبعده الصف نفسه
    بيتشال).

    `dropping` بيفرّق بين الاتنين، وده مش تفصيلة: فيه مستندات **تانية** بتشاور على الفاتورة
    دي — سطور استلام الكوبونات، واستهلاك النقاط، والحجوزات. الصف بتاع الفاتورة بيروح في
    الحذف بس، فالربط ده لازم يتفك في الحذف بس. فكّه في التعديل معناه إن تصليح سعر في فاتورة
    بيمسح سطور مستند استلام كوبونات محدش فتحه — والمستند بيفضل مكتوب عليه عدد كوبونات
    مالهاش سطور، والقيد الفريد على رقم الكوبون بيتفك فالكوبون يتسلّم تاني.
    """
    _drop_points(db, sales_invoice_id=invoice.id)
    _restore_serials(db, sold_invoice_id=invoice.id,
                     document_type="sales_invoice", document_id=invoice.id)
    _restore_batches(db, document_type="sales_invoice", document_id=invoice.id)
    _drop_stock(db, source_doc_type="sale", source_doc_id=invoice.id)
    entry_id = invoice.ledger_entry_id
    invoice.ledger_entry_id = None
    db.execute(delete(SalesInvoiceExpense).where(
        SalesInvoiceExpense.invoice_id == invoice.id))
    db.execute(delete(SalesInvoiceLine).where(
        SalesInvoiceLine.invoice_id == invoice.id))
    db.execute(delete(SalesInvoiceCoupon).where(
        SalesInvoiceCoupon.invoice_id == invoice.id))
    if dropping:
        # الصف بيروح، فأي مستند تاني بيشاور عليه لازم يفك الربط — وإلا المفتاح الأجنبي
        # بيرفض الحذف. سطر الاستلام `sales_invoice_id` بتاعه مش بيقبل NULL، فبيتمسح؛
        # والباقي بيتفك وبيفضل في مكانه.
        db.execute(delete(CouponReceiptLine).where(
            CouponReceiptLine.sales_invoice_id == invoice.id))
        db.execute(update(CouponRedemption).where(
            CouponRedemption.sales_invoice_id == invoice.id).values(sales_invoice_id=None))
        db.execute(update(Reservation).where(
            Reservation.sales_invoice_id == invoice.id).values(sales_invoice_id=None))
    db.flush()
    _drop_entry(db, entry_id)


def assert_sale_editable(db: Session, invoice: SalesInvoice) -> None:
    """مرتجع حقيقي متعلّق بالفاتورة بيمنع تعديلها.

    ده مش شرط محاسبي — ده اتساق: المرتجع بيقول «رجع منها ٥»، فتعديلها لـ٣ بيخلّي مستند
    موجود بيتكلم عن كمية مالهاش وجود. اللي عايز يعدّل بيمسح المرتجع الأول، وده بقى ممكن
    زي أي حاجة تانية.
    """
    returns = db.scalars(select(SalesReturn).where(
        SalesReturn.sales_invoice_id == invoice.id)).all()
    if returns:
        nums = "، ".join(r.document_number for r in returns[:3])
        raise DocumentEditError(
            f"الفاتورة دي عليها مرتجع ({nums}) — امسح المرتجع الأول وبعدين عدّل الفاتورة.")


def delete_sale(db: Session, *, invoice_id: int, actor_user_id: int) -> None:
    """حذف فاتورة بيع بالكامل وكل ما يتعلق بها من مرتجعات."""
    invoice = db.get(SalesInvoice, invoice_id)
    if invoice is None:
        raise DocumentEditError("فاتورة البيع مش موجودة.")
    returns = db.scalars(select(SalesReturn).where(
        SalesReturn.sales_invoice_id == invoice.id)).all()
    for ret in returns:
        # كل مرتجع بيتمسح باسمه في السجل. حذف الفاتورة بيجرّ مستندات تانية معاه، واللي
        # بيتشال في الضهر لازم يبقى مكتوب — وإلا سند مرتجع بيختفي وأول واحد يدوّر عليه
        # مايلاقيش حاجة بتقول راح فين.
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


# ---------------------------------------------------------------- السندات

def delete_voucher(db: Session, *, voucher_id: int, actor_user_id: int) -> None:
    """حذف سند — بيروح هو وقيده، مش بيتعكس.

    العكس كان بيكتب سند تاني «عكس SR-000012» جنب الأصلي، فالخزينة بتوري عمليتين على غلطة
    واحدة. السند اللي اتكتب غلط بيتمسح، والسند العكسي اللي كان اتكتب عليه قبل كده بيروح
    معاه — لأنه مالوش معنى من غيره.
    """
    from src.models.voucher import Voucher

    voucher = db.get(Voucher, voucher_id)
    if voucher is None:
        raise DocumentEditError("السند مش موجود.")
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


# ---------------------------------------------------------------- مرتجع المبيعات

def _resell_serials(db: Session, *, document_type: str, document_id: int,
                    invoice_id: int | None) -> None:
    """السيريالات اللي رجعت على المستند ده — ترجع «مبيعة» تاني.

    المرتجع بيرجّع السيريال للمخزن، فمسح المرتجع لازم يرجّعه لحالته قبله. السيريالات
    نفسها متعرفة من سجل حركتها على المستند — وده السبب اللي بيخلّي السجل ده يستاهل: حالة
    السيريال بتتخزّن كحالة واحدة، مافيش تاريخ فيها يتقرا بالعكس.

    الفاتورة اللي كان مبيع عليها بترجع كمان لما المرتجع كان مربوط بفاتورة. المرتجع الحر
    (٠٢٨) مالوش فاتورة، فالسيريال بيرجع «مبيع» من غير ربط — وهي الحالة اللي كان فيها
    قبل المرتجع بالظبط.
    """
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
    """بيشيل كل أثر مرتجع مبيعات — البضاعة تخرج تاني والفلوس ترجع زي ما كانت."""
    _drop_points(db, sales_return_id=ret.id)
    _resell_serials(db, document_type="sales_return", document_id=ret.id,
                    invoice_id=ret.sales_invoice_id)
    _restore_batches(db, document_type="sales_return", document_id=ret.id)
    _drop_stock(db, source_doc_type="sale_return", source_doc_id=ret.id)
    entry_id = ret.ledger_entry_id
    ret.ledger_entry_id = None
    db.execute(delete(SalesReturnLine).where(SalesReturnLine.return_id == ret.id))
    db.flush()
    _drop_entry(db, entry_id)


def delete_sales_return(db: Session, *, return_id: int, actor_user_id: int) -> None:
    ret = db.get(SalesReturn, return_id)
    if ret is None:
        raise DocumentEditError("المرتجع مش موجود.")
    doc = ret.document_number
    purge_sales_return(db, ret)
    db.delete(ret)
    db.flush()
    audit_record(db, action="sale_return.delete", actor_user_id=actor_user_id,
                 entity_type="sales_return", entity_id=return_id, before={"doc": doc})


# ---------------------------------------------------------------- مردود الشراء

def purge_purchase_return(db: Session, ret: PurchaseReturn) -> None:
    _restore_batches(db, document_type="purchase_return", document_id=ret.id)
    _drop_stock(db, source_doc_type="purchase_return", source_doc_id=ret.id)
    entry_id = ret.ledger_entry_id
    ret.ledger_entry_id = None
    db.execute(delete(PurchaseReturnLine).where(PurchaseReturnLine.return_id == ret.id))
    db.flush()
    _drop_entry(db, entry_id)


def delete_purchase_return(db: Session, *, return_id: int, actor_user_id: int) -> None:
    ret = db.get(PurchaseReturn, return_id)
    if ret is None:
        raise DocumentEditError("المردود مش موجود.")
    doc = ret.document_number
    purge_purchase_return(db, ret)
    db.delete(ret)
    db.flush()
    audit_record(db, action="purchase_return.delete", actor_user_id=actor_user_id,
                 entity_type="purchase_return", entity_id=return_id, before={"doc": doc})


# ---------------------------------------------------------------- فاتورة الشراء

def purge_purchase(db: Session, invoice: PurchaseInvoice) -> None:
    _restore_serials(db, document_type="purchase_invoice", document_id=invoice.id)
    _restore_batches(db, document_type="purchase_invoice", document_id=invoice.id)
    _drop_stock(db, source_doc_type="purchase", source_doc_id=invoice.id)
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
            f"الفاتورة دي عليها مردود ({nums}) — امسح المردود الأول وبعدين عدّل الفاتورة.")


def delete_purchase(db: Session, *, purchase_id: int, actor_user_id: int) -> None:
    invoice = db.get(PurchaseInvoice, purchase_id)
    if invoice is None:
        raise DocumentEditError("فاتورة الشراء مش موجودة.")
    assert_purchase_editable(db, invoice)
    doc = invoice.document_number
    purge_purchase(db, invoice)
    db.delete(invoice)
    db.flush()
    audit_record(db, action="purchase.delete", actor_user_id=actor_user_id,
                 entity_type="purchase_invoice", entity_id=purchase_id,
                 before={"doc": doc})
