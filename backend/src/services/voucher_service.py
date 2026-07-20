"""Cash vouchers — 018-finance-vouchers.

Each voucher posts ONE balanced ledger entry (append-only, reverse-once) and is what finally
closes the money cycle: a credit invoice raises a receivable, a receipt settles it.

    receipt      debit  cash location        / credit customer receivable
    payment      debit  supplier payable     / credit cash location
    rep_handover debit  treasury             / credit the rep's custody
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountNature, Direction
from src.models.role import RoleName
from src.models.supplier import Supplier, SupplierAccount
from src.models.user import User
from src.models.voucher import Voucher, VoucherKind
from src.models.warehouse import Custody
from src.services import account_resolver, audit_service, ledger_service, treasury_service
from src.services.ledger_service import LineInput

_PREFIX = {
    VoucherKind.receipt: "RCV",
    VoucherKind.payment: "PAY",
    VoucherKind.rep_handover: "HND",
    VoucherKind.expense: "EXP",
    VoucherKind.cash_transfer: "TRF",
}


class VoucherError(Exception):
    pass


def _doc_number(db: Session, kind: VoucherKind) -> str:
    n = db.scalar(
        select(func.count()).select_from(Voucher).where(Voucher.kind == kind)
    ) or 0
    return f"{_PREFIX[kind]}-{n + 1:06d}"


def _positive(amount) -> Decimal:
    value = to_money(amount)
    if value <= ZERO:
        raise VoucherError("قيمة السند لازم تكون أكبر من صفر.")
    return value


def _customer_account(db: Session, customer_id: int) -> CustomerAccount:
    if db.get(Customer, customer_id) is None:
        raise VoucherError("العميل غير موجود.")
    acc = db.scalar(select(CustomerAccount).where(CustomerAccount.customer_id == customer_id))
    if acc is None:
        raise VoucherError("العميل ليس له حساب ذمم.")
    return acc


def _supplier_account(db: Session, supplier_id: int) -> SupplierAccount:
    if db.get(Supplier, supplier_id) is None:
        raise VoucherError("المورد غير موجود.")
    acc = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id))
    if acc is None:
        raise VoucherError("المورد ليس له حساب ذمم.")
    return acc


def _create(
    db: Session, *, kind: VoucherKind, amount: Decimal, cash_account_id: int,
    party_account_id: int, debit_account_id: int, credit_account_id: int,
    actor_user_id: int, voucher_date: date | None, description: str | None,
    reference: str | None, payment_method: str | None, entry_type: str, statement: str,
    customer_id: int | None = None, supplier_id: int | None = None,
    rep_user_id: int | None = None, reverses_id: int | None = None,
    treasury_id: int | None = None, to_treasury_id: int | None = None,
) -> Voucher:
    voucher = Voucher(
        document_number=_doc_number(db, kind), kind=kind, amount=amount,
        customer_id=customer_id, supplier_id=supplier_id, rep_user_id=rep_user_id,
        cash_account_id=cash_account_id, party_account_id=party_account_id,
        treasury_id=treasury_id, to_treasury_id=to_treasury_id,
        voucher_date=voucher_date or date.today(), payment_method=payment_method,
        reference=reference, description=description, ledger_entry_id=None,
        reverses_id=reverses_id, actor_user_id=actor_user_id,
    )
    db.add(voucher)
    db.flush()
    entry = ledger_service.post_entry(
        db, entry_type=entry_type, actor_user_id=actor_user_id,
        description=description or statement,
        entry_date=voucher.voucher_date,
        lines=[
            LineInput(debit_account_id, Direction.debit, amount, statement=statement),
            LineInput(credit_account_id, Direction.credit, amount, statement=statement),
        ],
    )
    voucher.ledger_entry_id = entry.id
    db.flush()
    audit_service.record(
        db, action=f"voucher.{kind.value}", actor_user_id=actor_user_id,
        entity_type="voucher", entity_id=voucher.id,
        after={"doc": voucher.document_number, "amount": str(amount)},
    )
    return voucher


def _cash_side(
    db: Session, *, actor_role: RoleName, actor_user_id: int, treasury_id: int | None
) -> tuple[int, int | None]:
    """Which ledger account holds the cash, and the treasury it belongs to.

    A rep always moves cash through his own custody; office users use the named safe (or the
    default one), which is what makes per-branch and bank safes work.
    """
    if actor_role == RoleName.sales_rep:
        return account_resolver.resolve_cash_account(
            db, role=actor_role, user_id=actor_user_id).id, None
    treasury = treasury_service.resolve(db, treasury_id)
    return treasury.account_id, treasury.id


def create_receipt(
    db: Session, *, customer_id: int, amount, actor_user_id: int, actor_role: RoleName,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None, payment_method: str | None = None,
    treasury_id: int | None = None,
) -> Voucher:
    """سند قبض — تحصيل من عميل. النقدية تدخل الخزينة المختارة أو عهدة المندوب المحصِّل."""
    value = _positive(amount)
    party = _customer_account(db, customer_id)
    cash_account_id, safe_id = _cash_side(
        db, actor_role=actor_role, actor_user_id=actor_user_id, treasury_id=treasury_id)
    return _create(
        db, kind=VoucherKind.receipt, amount=value, cash_account_id=cash_account_id,
        party_account_id=party.account_id, debit_account_id=cash_account_id,
        credit_account_id=party.account_id, actor_user_id=actor_user_id,
        voucher_date=voucher_date, description=description, reference=reference,
        payment_method=payment_method, entry_type="receipt", statement="تحصيل من عميل",
        customer_id=customer_id, treasury_id=safe_id,
    )


def _assert_cash_available(db: Session, account_id: int, value: Decimal) -> None:
    available = ledger_service.balance_of(db, account_id)
    if value > available:
        raise VoucherError(
            f"الرصيد النقدي غير كافٍ — المتاح {available} والمطلوب صرفه {value}."
        )


def create_payment(
    db: Session, *, supplier_id: int, amount, actor_user_id: int, actor_role: RoleName,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None, payment_method: str | None = None,
    treasury_id: int | None = None,
) -> Voucher:
    """سند صرف — دفع لمورد من الخزينة."""
    value = _positive(amount)
    party = _supplier_account(db, supplier_id)
    cash_account_id, safe_id = _cash_side(
        db, actor_role=actor_role, actor_user_id=actor_user_id, treasury_id=treasury_id)
    _assert_cash_available(db, cash_account_id, value)
    return _create(
        db, kind=VoucherKind.payment, amount=value, cash_account_id=cash_account_id,
        party_account_id=party.account_id, debit_account_id=party.account_id,
        credit_account_id=cash_account_id, actor_user_id=actor_user_id,
        voucher_date=voucher_date, description=description, reference=reference,
        payment_method=payment_method, entry_type="payment", statement="دفع لمورد",
        supplier_id=supplier_id, treasury_id=safe_id,
    )


def create_expense(
    db: Session, *, expense_account_id: int, amount, actor_user_id: int,
    actor_role: RoleName, voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None, payment_method: str | None = None,
    treasury_id: int | None = None,
) -> Voucher:
    """سند مصروف — إيجار/مرتبات/بنزين… مدين حساب المصروف ودائن الخزينة."""
    value = _positive(amount)
    account = db.get(Account, expense_account_id)
    if account is None or not account.active:
        raise VoucherError("حساب المصروف غير موجود.")
    if account.nature != AccountNature.expense:
        raise VoucherError("لازم تختار حسابًا من طبيعة «مصروفات».")
    if not account.is_postable:
        raise VoucherError("لا يمكن الترحيل على حساب تجميعي — اختر حسابًا فرعيًا.")
    cash_account_id, safe_id = _cash_side(
        db, actor_role=actor_role, actor_user_id=actor_user_id, treasury_id=treasury_id)
    _assert_cash_available(db, cash_account_id, value)
    return _create(
        db, kind=VoucherKind.expense, amount=value, cash_account_id=cash_account_id,
        party_account_id=account.id, debit_account_id=account.id,
        credit_account_id=cash_account_id, actor_user_id=actor_user_id,
        voucher_date=voucher_date, description=description, reference=reference,
        payment_method=payment_method, entry_type="expense",
        statement=f"مصروف — {account.name or account.code or ''}".strip(),
        treasury_id=safe_id,
    )


def create_cash_transfer(
    db: Session, *, from_treasury_id: int, to_treasury_id: int, amount, actor_user_id: int,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None,
) -> Voucher:
    """تحويل بين الخزائن — مدين الخزينة المستقبِلة ودائن المرسِلة."""
    value = _positive(amount)
    if from_treasury_id == to_treasury_id:
        raise VoucherError("لا يمكن التحويل لنفس الخزينة.")
    source = treasury_service.get_treasury(db, from_treasury_id)
    dest = treasury_service.get_treasury(db, to_treasury_id)
    _assert_cash_available(db, source.account_id, value)
    return _create(
        db, kind=VoucherKind.cash_transfer, amount=value, cash_account_id=source.account_id,
        party_account_id=dest.account_id, debit_account_id=dest.account_id,
        credit_account_id=source.account_id, actor_user_id=actor_user_id,
        voucher_date=voucher_date, description=description, reference=reference,
        payment_method=None, entry_type="cash_transfer",
        statement=f"تحويل من {source.name} إلى {dest.name}",
        treasury_id=source.id, to_treasury_id=dest.id,
    )


def create_handover(
    db: Session, *, rep_user_id: int, amount, actor_user_id: int,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None,
) -> Voucher:
    """توريد المندوب — نقل النقدية من عهدة المندوب لخزينة الشركة.

    مقيّد برصيد العهدة: المندوب ما يقدرش يورّد أكتر مما تحصّله فعلاً.
    """
    value = _positive(amount)
    if db.get(User, rep_user_id) is None:
        raise VoucherError("المندوب غير موجود.")
    custody = db.scalar(select(Custody).where(Custody.rep_id == rep_user_id))
    if custody is None or custody.account_id is None:
        raise VoucherError("المندوب ليس له عهدة بحساب نقدي.")
    held = ledger_service.balance_of(db, custody.account_id)
    if value > held:
        raise VoucherError(f"رصيد عهدة المندوب {held} — لا يمكن توريد {value}.")
    treasury = account_resolver.treasury_account(db)
    return _create(
        db, kind=VoucherKind.rep_handover, amount=value, cash_account_id=treasury.id,
        party_account_id=custody.account_id, debit_account_id=treasury.id,
        credit_account_id=custody.account_id, actor_user_id=actor_user_id,
        voucher_date=voucher_date, description=description, reference=reference,
        payment_method=None, entry_type="rep_handover", statement="توريد مندوب للخزينة",
        rep_user_id=rep_user_id,
    )


def reverse_voucher(db: Session, *, voucher_id: int, actor_user_id: int) -> Voucher:
    """عكس السند (مرة واحدة) — يعكس القيد ويسجل سندًا عكسيًا."""
    original = db.get(Voucher, voucher_id)
    if original is None:
        raise VoucherError("السند غير موجود.")
    if original.reverses_id is not None:
        raise VoucherError("لا يمكن عكس سند عكسي.")
    if db.scalar(select(Voucher).where(Voucher.reverses_id == voucher_id)) is not None:
        raise VoucherError("السند معكوس بالفعل.")
    ledger_service.reverse_entry(db, original_id=original.ledger_entry_id,
                                 actor_user_id=actor_user_id)
    mirror = Voucher(
        document_number=_doc_number(db, original.kind), kind=original.kind,
        amount=original.amount, customer_id=original.customer_id,
        supplier_id=original.supplier_id, rep_user_id=original.rep_user_id,
        cash_account_id=original.cash_account_id, party_account_id=original.party_account_id,
        treasury_id=original.treasury_id, to_treasury_id=original.to_treasury_id,
        voucher_date=date.today(), payment_method=original.payment_method,
        reference=original.reference, description=f"عكس {original.document_number}",
        ledger_entry_id=None, reverses_id=voucher_id, actor_user_id=actor_user_id,
    )
    db.add(mirror)
    db.flush()
    audit_service.record(db, action="voucher.reverse", actor_user_id=actor_user_id,
                         entity_type="voucher", entity_id=mirror.id,
                         before={"doc": original.document_number})
    return mirror


def list_vouchers(
    db: Session, *, kind: VoucherKind | None = None, customer_id: int | None = None,
    supplier_id: int | None = None, rep_user_id: int | None = None,
    treasury_id: int | None = None,
    date_from: date | None = None, date_to: date | None = None,
) -> list[Voucher]:
    stmt = select(Voucher)
    if kind is not None:
        stmt = stmt.where(Voucher.kind == kind)
    if treasury_id is not None:
        stmt = stmt.where(Voucher.treasury_id == treasury_id)
    if customer_id is not None:
        stmt = stmt.where(Voucher.customer_id == customer_id)
    if supplier_id is not None:
        stmt = stmt.where(Voucher.supplier_id == supplier_id)
    if rep_user_id is not None:
        stmt = stmt.where(Voucher.rep_user_id == rep_user_id)
    if date_from is not None:
        stmt = stmt.where(Voucher.voucher_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Voucher.voucher_date <= date_to)
    return db.scalars(stmt.order_by(Voucher.voucher_date.desc(), Voucher.id.desc())).all()
