"""Purchases + partial returns (T020). FR-010–012. Raw materials in; supplier credit; proportional
return money reversal."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY, PCT, QTY
from src.models.stock import LocationKind


class PurchaseInvoice(Base):
    __tablename__ = "purchase_invoice"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("supplier.id"), nullable=False)
    # Now only the DEFAULT for new lines — each line carries its own warehouse (030).
    location_kind: Mapped[LocationKind] = mapped_column(Enum(LocationKind), nullable=False)
    location_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # --- 030 document fields (mirrors the sales invoice) ---
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    expense_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    # The SUPPLIER's own invoice number — kept alongside our generated document_number.
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # (031) The day the goods were received, which is not always the day the invoice was typed —
    # the same field the sale has as `invoice_date` and the return as `return_date`, and for the
    # same reason: a document dated one day and posted on another makes every statement disagree
    # with the paper.
    purchase_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    # الإجمالي قبل خصم الفاتورة — مجموع السطور بعد خصم كل سطر.
    #
    # Mirrors the sale exactly: a line carries its own discount, those net line totals add up to
    # `gross`, the invoice discount comes off that once to give `net`, and the tax sits on `net`.
    # Doing it in that order matters — an invoice discount applied per line and a line discount
    # applied to the invoice give different money on the same numbers.
    gross: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    fixed_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    variable_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    combined_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    net: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    tax_amount: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    # اللي اتدفع فعلاً = net + الضريبة. اسمه `total` من قبل الخصومات ما تدخل، وسايبينه زي ما هو
    # عشان الفواتير القديمة تفضل مقروءة.
    total: Mapped[object] = mapped_column(MONEY, nullable=False)
    cash_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    credit_amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Nullable so the row can be inserted before its ledger entry exists (Postgres enforces FKs;
    # a 0 placeholder would violate the constraint). Always set to the real id before commit.
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    lines: Mapped[list[PurchaseInvoiceLine]] = relationship(cascade="all, save-update")


class PurchaseInvoiceLine(Base):
    __tablename__ = "purchase_invoice_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("purchase_invoice.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False)  # per chosen unit snapshot
    # خصم السطر. NULL معناه «مفيش خصم متفق عليه» — مش صفر.
    #
    # Nullable on purpose, the same way the sale's is: an agreed zero and no agreement at all are
    # different facts, and a column defaulted to zero cannot tell them apart.
    discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Unit of measure used on this line (008); NULL = base. Stock in base = quantity × unit_factor.
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(QTY, default=1, nullable=False)
    # (030) The warehouse THIS line is received into. NULL only on pre-030 rows, which the
    # migration backfills from the invoice.
    line_location_kind: Mapped[LocationKind | None] = mapped_column(Enum(LocationKind), nullable=True)
    line_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class PurchaseReturn(Base):
    __tablename__ = "purchase_return"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    document_number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    # المردود المستقل — أصناف راجعة لمورد، من غير ما يتعلّق بفاتورة بعينها.
    #
    # الشركة بترجّع بضاعة لمورد من غير ما تكون عارفة — أو مهتمة — بأنهي فاتورة جابتها. البضاعة
    # في المخزن، والمورد معروف، والقيمة متفق عليها. ربط كل مردود بفاتورة كان معناه إن اللي
    # بيرجّع لازم يدوّر على الفاتورة الأصلية الأول، وإن بضاعة اتجمّعت من فواتير كتير ماينفعش
    # ترجع في مستند واحد.
    #
    # `purchase_invoice_id` بقى اختياري: لو موجود، المردود بيتقيّد بكميات الفاتورة دي (زي ما كان)؛
    # ولو فاضي، ده مردود مستقل بيقف على نفسه. ده نفس اللي مرتجع البيع عمله في ٠٢٨.
    purchase_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("purchase_invoice.id"), nullable=True
    )
    # المورد — كان بيتقرا من الفاتورة. المردود المستقل مالوش فاتورة، فبيشيله بنفسه.
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("supplier.id"), nullable=True)
    # المخزن اللي البضاعة خرجت منه. الفاتورة كانت بتقول ده؛ المستقل بيتسأل عنه.
    origin_location_kind: Mapped[LocationKind | None] = mapped_column(
        Enum(LocationKind), nullable=True)
    origin_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # نفس حقول مستند الفاتورة — المردود نسخة منها بالعكس، فالورقتين بيتكتبوا بنفس الإيد.
    #
    # كانت الترويسة: تاريخ وملاحظات وبس. يعني اللي بيكتب مردود مالوش مكان يكتب فيه رقم إشعار
    # المورد، ولا يقول القيد بينزل على أنهي حساب، ولا يسجّل البيانات التلاتة اللي كل مستند تاني
    # في النظام بيسجّلها. والتقارير اللي بتقرا الحقول دي كانت بتلاقيها فاضية على المردودات وحدها.
    expense_account_id: Mapped[int | None] = mapped_column(ForeignKey("account.id"), nullable=True)
    external_document_number: Mapped[str | None] = mapped_column(String(40), nullable=True)
    statement1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    statement3: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # سلّم الأرقام زي الفاتورة: قبل الخصم، نسبة الخصم، وبعده. `value` هو الصافي.
    gross: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    variable_discount_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    combined_pct: Mapped[object] = mapped_column(PCT, nullable=False, default=0)
    value: Mapped[object] = mapped_column(MONEY, nullable=False)
    # The day the goods actually went back — not the day the row was typed. `created_at` is when
    # somebody sat at the screen, and goods returned on Thursday and entered on Sunday would land
    # in the wrong week on every report that groups by day. The sale return got this in 0055 and
    # the purchase in 0056; this is the fourth and last trade document to carry its own date.
    return_date: Mapped[object | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Nullable so the row can be inserted before its ledger entry exists (Postgres enforces FKs;
    # a 0 placeholder would violate the constraint). Always set to the real id before commit.
    ledger_entry_id: Mapped[int | None] = mapped_column(ForeignKey("ledger_entry.id"), nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    # المردود المعكوس — للتصحيح، مش لحاجة تانية.
    #
    # المردود المرحّل ماينفعش يتعدّل في مكانه: البضاعة خرجت من المخزن والقيد اتكتب، والدفتر
    # مابيتمحاش. فالتعديل = عكس كامل وكتابة من جديد، زي الفاتورة بالظبط.
    #
    # والصف بيفضل موجود بعد العكس مش بيتمسح: رقم المستند اتصرف، والقيد المضاد بيشاور عليه،
    # واللي بيراجع دفتر لازم يلاقي المستندين الاتنين. اللي بيتغيّر إنه **مابيتحسبش**: مابيظهرش
    # في السجل، ومابيتعدّش في «اترجّع كام من الفاتورة دي» — يعني الكمية بترجع تتاح للمردود
    # من جديد.
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reversal_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), nullable=True)

    lines: Mapped[list[PurchaseReturnLine]] = relationship(cascade="all, save-update")


class PurchaseReturnLine(Base):
    __tablename__ = "purchase_return_line"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("purchase_return.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("item.id"), nullable=False)
    quantity: Mapped[object] = mapped_column(QTY, nullable=False)
    # سعر السطر. المردود المربوط بفاتورة بياخده من سطرها؛ المستقل بيتكتب فيه — البضاعة بترجع
    # بالسعر المتفق عليه دلوقتي، مش لازم يكون سعر شرائها.
    unit_price: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
    # نفس ما على سطر الفاتورة: خصم السطر، والوحدة ومعاملها، ومخزن السطر.
    #
    # مخزن السطر مش تفصيلة: الفاتورة الواحدة ممكن تتوزّع على أكتر من مخزن، والمردود اللي
    # بيرجّعها لازم يقدر يطلّع كل صنف من المخزن اللي فيه فعلاً.
    discount_pct: Mapped[object | None] = mapped_column(PCT, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit_factor: Mapped[object] = mapped_column(QTY, default=1, nullable=False)
    line_location_kind: Mapped[LocationKind | None] = mapped_column(
        Enum(LocationKind), nullable=True)
    line_location_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    line_total: Mapped[object] = mapped_column(MONEY, nullable=False, default=0)
