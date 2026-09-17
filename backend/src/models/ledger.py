"""Ledger core: immutable double-entry (T013–T015).

The ledger is the single source of truth. Every treasury, custody, and customer-account
balance is derived from `ledger_line` — never stored standalone (Constitution VI / FR-026).
Posted entries/lines are immutable; corrections are new linked reversal entries (FR-027/028).
"""
from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    String,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.db import Base, BigIntPK
from src.core.money import MONEY
from src.models.journal import Journal  # noqa: F401 — علاقة `LedgerEntry.journal`


class AccountType(str, enum.Enum):
    treasury = "treasury"
    custody = "custody"
    customer_receivable = "customer_receivable"
    # Sales & Inventory (002) extension — same ledger, additive (research R1).
    supplier_payable = "supplier_payable"      # normal credit (mirrors customer_receivable)
    sales_revenue = "sales_revenue"            # normal credit (singleton P&L)
    purchases_expense = "purchases_expense"    # normal debit (singleton P&L)
    # After-Sales Loyalty (003) extension — additive.
    loyalty_expense = "loyalty_expense"        # normal debit (singleton P&L)
    # General Ledger (005) extension — additive.
    opening_balance_equity = "opening_balance_equity"  # normal credit (singleton equity)
    # User-defined chart accounts (groups + postable leaves the user creates).
    user_defined = "user_defined"


class AccountNature(str, enum.Enum):
    """Chart classification (005). Drives the trial-balance sign and the normal side."""

    asset = "asset"
    liability = "liability"
    equity = "equity"
    income = "income"
    expense = "expense"


class Direction(str, enum.Enum):
    debit = "debit"
    credit = "credit"


class EntryState(str, enum.Enum):
    """حالة القيد — مسودة، مرحّل، ملغي (نفس دورة أودو).

    المسودة حرّة: تكتب سطر واحد، تسيب القيد ناقص، ترجعله بكره تكمّله. الترحيل هو
    الخطوة اللي بتطلب التوازن وبتصرف الرقم، لأنه هو اللي بيدخل الحسابات فعلاً.

    القيمة نص مش `Enum` في القاعدة عن قصد: العمود ده بيتضاف على جدول فيه داتا عن طريق
    `_ADDED_COLUMNS` (ALTER TABLE ADD COLUMN)، و`CREATE TYPE` مابيعديش من هناك.
    """

    draft = "draft"
    posted = "posted"
    cancelled = "cancelled"


class MoveType(str, enum.Enum):
    """نوع المستند المحاسبي — نفس `move_type` بتاع أودو.

    أودو مافيهوش «فاتورة» و«قيد»: فيه `account.move` واحد، والنوع ده هو اللي بيقول
    هو إيه. اللي مالوش نوع منهم (سند، شيك، راتب، إهلاك) بيبقى `entry` — وده نفس
    اللي بيعمله أودو بالظبط مع المدفوعات والقيود العادية.

    نص مش `Enum` في القاعدة، لنفس سبب `EntryState`: العمود بيتضاف بـALTER TABLE.
    """

    entry = "entry"
    out_invoice = "out_invoice"    # فاتورة بيع
    out_refund = "out_refund"      # مردود بيع
    in_invoice = "in_invoice"      # فاتورة شرا
    in_refund = "in_refund"        # مردود شرا


class PartnerKind(str, enum.Enum):
    """الشريك ده مين — عميل ولا مورد ولا موظف.

    أودو عنده `res.partner` واحد للتلاتة، وعندنا تلات جداول منفصلة. فالشريك بيتكتب
    نوع + رقم، زي `Account.owner_ref` الموجود من ٠٠١ — أرخص من جدول شركاء موحّد
    يتبني دلوقتي ويتعمله نقل من تلات جداول شغّالة.
    """

    customer = "customer"
    supplier = "supplier"
    employee = "employee"


class Account(Base):
    """A balance-bearing bucket and a node in the chart of accounts (005).

    Balance is derived from its lines. Postable leaves accept journal lines; group nodes
    (is_postable=False) only aggregate their descendants. The seven 001/002/003 system
    accounts live here too, re-homed under standard group headings (research R1/R2).
    """

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    account_type: Mapped[AccountType] = mapped_column(Enum(AccountType), nullable=False)
    # FK target depends on account_type (custody.id / customer_account.id); NULL for the
    # singleton treasury. Kept as a plain ref to avoid polymorphic FK coupling.
    owner_ref: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    normal_side: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)

    # Which branch this account belongs to (024 — multi-branch). Each branch has its own full
    # chart; NULL only transiently before the startup backfill homes it to the main branch.
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branch.id"), nullable=True, index=True
    )

    # --- Chart of accounts columns (005, additive; nullable so legacy rows backfill) ---
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("account.id"), nullable=True, index=True
    )
    code: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    nature: Mapped[AccountNature | None] = mapped_column(Enum(AccountNature), nullable=True)
    is_postable: Mapped[bool] = mapped_column(default=True, nullable=False)
    is_system: Mapped[bool] = mapped_column(default=False, nullable=False)
    # (المرحلة ٣) الحساب ده بتتقفل سطوره على بعضها؟ — الذمم والدائنين أيوه، الإيراد
    # والمصروف لأ. زي `account.reconcile` في أودو بالظبط: هو اللي بيحدد أنهي سطور
    # ليها «متبقّي» وبتظهر في شاشة المطابقة. بيتحط تلقائي على حسابات العملاء
    # والموردين، وبيتظبط بالإيد لحساب زي «سلف العاملين» أو «شيكات تحت التحصيل».
    reconcilable: Mapped[bool] = mapped_column(default=False, nullable=False)
    # «يظهر في» (B8) — which statement this account is presented on. Nature already implies the
    # usual answer, so this is the override for the cases where it does not: a contra account, or
    # a memo account the client does not want on either face. NULL = follow the nature.
    appears_in: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # «المستوى الرئيسي» — the standard statement grouping this account rolls up into
    # («أصول متداولة»، «تكلفة الإيرادات»، «مصروفات غير مباشرة»). Free text, because every chart
    # arranges these differently and an enum of ours would be wrong for the next client.
    main_level: Mapped[str | None] = mapped_column(String(80), nullable=True)

    lines: Mapped[list[LedgerLine]] = relationship(back_populates="account")
    parent: Mapped[Account | None] = relationship(remote_side=[id], backref="children")


class LedgerEntry(Base):
    """ترويسة القيد: دفتره، حالته، رقمه، وسطوره.

    المرحّل لازم يكون متوازن (Σمدين = Σدائن) — بيتفرض في `ledger_service.post_entry`
    مش هنا. المسودة معفية من القاعدة دي عن قصد؛ شوف `EntryState`.
    """

    __tablename__ = "ledger_entry"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    entry_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # الدفتر اللي القيد بيعيش فيه (المرحلة ١). NULL للقيود القديمة قبل سكربت النقل —
    # `journal_registry.resolve` بيحدده من `entry_type` عند الترحيل.
    journal_id: Mapped[int | None] = mapped_column(
        ForeignKey("journal.id"), nullable=True, index=True
    )
    # الحالة. الافتراضي `posted` عن قصد: كل مستند بيكتب قيده جاهز ومرحّل، والمسودة
    # حاجة بيعملها اللي بيكتب قيد بإيده. فالافتراضي ده معناه إن مافيش موديول اتغيّر.
    state: Mapped[str] = mapped_column(
        String(12), nullable=False, default=EntryState.posted.value
    )
    # رقم القيد المتسلسل في دفتره (`INV/2026/00001`). بيتصرف عند الترحيل بس — المسودة
    # مالهاش رقم عشان الأرقام تفضل متصلة من غير فجوات لمسودة اتمسحت.
    number: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # --- المرحلة ٢: القيد هو المستند (`account.move`) ---------------------------------
    # نوع المستند. NULL = قيد قديم قبل سكربت النقل، وبيتقرا `entry` زي ما أودو بيعمل
    # مع أي حركة مالهاش نوع.
    move_type: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    # الشريك على مستوى المستند — مين الفاتورة دي عليه. السطر ممكن يخالفه (قيد راتب
    # فيه عشرين موظف)، فالحساب الحقيقي بيتعمل من سطور، وده للعرض والتصفية.
    partner_kind: Mapped[str | None] = mapped_column(String(12), nullable=True)
    partner_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    # تاريخ الاستحقاق. من غير شروط دفع بيتحط بإيد، وافتراضيه تاريخ القيد — يعني
    # «مستحق دلوقتي»، وهو الصح لفاتورة نقدي.
    invoice_date_due: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    # حالة الدفع — بتتحسب من متبقّي السطور في المرحلة ٣ (تسوية). العمود بيتضاف دلوقتي
    # عشان النقل يعدّي مرة واحدة على جدول فيه ملايين السطور بدل مرتين.
    payment_state: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    # (المرحلة ٤) سلسلة التجزئة — بتتملي بس لو دفتر القيد شغّال عليه `restrict_mode_hash`.
    # الرقم بيقول مكان القيد في سلسلة دفتره، والبصمة محسوبة من محتواه + بصمة اللي قبله،
    # فتغيير مليم في قيد قديم بيكسر كل اللي بعده وتقرير السلامة بيوقف عليه.
    secure_sequence_number: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    inalterable_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    # Accounting/business date (005). User-chosen; the trial balance filters by this, NOT
    # created_at (opening balances are intentionally back-dated). NULL for legacy posts,
    # which fall back to created_at::date.
    entry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), nullable=False)
    # Originating rep; attribution survives customer reassignment (FR-020a).
    rep_id: Mapped[int | None] = mapped_column(ForeignKey("user.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branch.id"), nullable=True)
    # Set only on reversal entries; UNIQUE => an entry can be reversed at most once (FR-027).
    # مرجع المصدر لو القيد جاي من برّه — مفتاح العملية في النظام اللي اتنقل منه.
    #
    # من غيره الاستيراد مايعرفش يفرّق بين «القيد ده دخل قبل كده» و«قيد شبهه»، فالإعادة
    # بتبقى إما تكرار كامل أو تخطّي كامل. الاتنين غلط: التكرار بيضاعف الأرصدة، والتخطّي
    # بيسيب اللي فشل أول مرة بره للأبد.
    external_ref: Mapped[str | None] = mapped_column(
        String(60), nullable=True, index=True
    )
    reverses_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("ledger_entry.id"), unique=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    lines: Mapped[list[LedgerLine]] = relationship(
        back_populates="entry", cascade="all, save-update"
    )
    journal: Mapped["Journal | None"] = relationship("Journal", lazy="joined")


class LedgerLine(Base):
    """A debit or credit leg of an entry. Immutable once posted."""

    __tablename__ = "ledger_line"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_ledger_line_amount_positive"),)

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("ledger_entry.id"), nullable=False, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("account.id"), nullable=False, index=True)
    direction: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    amount: Mapped[object] = mapped_column(MONEY, nullable=False)
    # Per-line بيان (005). Set by journal entries; NULL for 001/002/003 posts.
    statement: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Optional analytical cost-center dimension (006). NULL for untagged/legacy posts.
    cost_center_id: Mapped[int | None] = mapped_column(
        ForeignKey("cost_center.id"), nullable=True, index=True
    )
    # --- المرحلة ٢: الشريك والاستحقاق على السطر -------------------------------------
    # الشريك على السطر نفسه زي `account.move.line.partner_id`. ده اللي بيخلّي دفتر
    # الشريك وأعمار الديون يتحسبوا من الدفتر مباشرة بدل ما يمرّوا على جدول المستندات —
    # والقيد اللي فيه أكتر من شريك (راتب، تحصيل مندوب) يتقسّم صح.
    partner_kind: Mapped[str | None] = mapped_column(String(12), nullable=True)
    partner_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    # تاريخ استحقاق السطر. الأعمار بتترتب عليه هو مش على تاريخ القيد: الفاتورة
    # المؤجّلة عمرها بيبدأ من استحقاقها.
    date_maturity: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    # --- المرحلة ٣: المتبقّي والمطابقة ------------------------------------------------
    # المتبقّي بإشارته: مدين موجب، دائن سالب، وصفر = اتقفل بالكامل. NULL معناها «السطر
    # ده مش على حساب بيتقفل» (إيراد، مصروف، مخزون) — مش «متبقّيه صفر».
    amount_residual: Mapped[object | None] = mapped_column(MONEY, nullable=True)
    # المجموعة اللي السطر اتقفل فيها. NULL = لسه مفتوح أو مقفول جزئياً.
    full_reconcile_id: Mapped[int | None] = mapped_column(
        ForeignKey("full_reconcile.id"), nullable=True, index=True
    )

    entry: Mapped[LedgerEntry] = relationship(back_populates="lines")
    account: Mapped[Account] = relationship(back_populates="lines")
    # حصص التوزيع التحليلي — فاضية في الحالة الشايعة (مركز واحد على العمود فوق).
    # `selectin` عشان عرض قيد بسطوره مايبقاش استعلام لكل سطر.
    distributions: Mapped[list["LedgerLineDistribution"]] = relationship(  # noqa: F821
        "LedgerLineDistribution",
        primaryjoin="LedgerLine.id == foreign(LedgerLineDistribution.line_id)",
        lazy="selectin", viewonly=True,
    )


class LedgerImmutableError(Exception):
    """Raised when code attempts to mutate or delete a posted ledger row."""


def _block_mutation(mapper, connection, target):  # noqa: ANN001
    raise LedgerImmutableError(
        f"{type(target).__name__} is immutable; post a reversal entry instead (FR-027/028)."
    )


# الحارس اتشال بطلب العميل.
#
# كان بيمنع أي تعديل أو حذف على قيد مرحّل، والتصحيح الوحيد المسموح بيه هو قيد مضاد. ده
# اللي كان بيخلّي تعديل سعر في فاتورة يسيب وراه قيدين في كشف الحساب. دلوقتي المستند
# بيتعدّل في مكانه، وده معناه إن أثره القديم لازم يتشال — والحارس كان بيمنع ده بالظبط.
#
# `LedgerImmutableError` و`_block_mutation` سايبين: كود قديم لسه بيمسك الاستثناء ده،
# ومسحه كان هيكسره من غير سبب. والحارس ممكن يرجع بسطرين لو الشركة يوم احتاجت الإقفال.
_ = _block_mutation

