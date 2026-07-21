"""Cheques — 020-finance-reports.

A cheque is a promise, not cash. Registering one moves the value into a holding account
(«شيكات تحت التحصيل» / «شيكات تحت الدفع»); only settlement touches a treasury. A bounced
incoming cheque puts the debt back on the customer.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.cheque import Cheque, ChequeDirection, ChequeStatus
from src.models.ledger import Account, AccountNature, AccountType, Direction
from src.services import audit_service, ledger_service, treasury_service, voucher_service
from src.services.ledger_service import LineInput

# Holding accounts, created once on first use (system accounts, not user-editable).
UNDER_COLLECTION_CODE = "1150"
CHEQUES_PAYABLE_CODE = "2150"


class ChequeError(Exception):
    pass


def _holding_account(db: Session, *, code: str, name: str, nature: AccountNature) -> Account:
    acc = db.scalar(select(Account).where(Account.code == code))
    if acc is None:
        acc = Account(
            account_type=AccountType.user_defined, owner_ref=None,
            normal_side=Direction.debit if nature == AccountNature.asset else Direction.credit,
            code=code, name=name, nature=nature, is_postable=True, is_system=True,
        )
        db.add(acc)
        db.flush()
    return acc


def under_collection_account(db: Session) -> Account:
    return _holding_account(db, code=UNDER_COLLECTION_CODE, name="شيكات تحت التحصيل",
                            nature=AccountNature.asset)


def cheques_payable_account(db: Session) -> Account:
    return _holding_account(db, code=CHEQUES_PAYABLE_CODE, name="شيكات تحت الدفع",
                            nature=AccountNature.liability)


def _doc_number(db: Session, direction: ChequeDirection) -> str:
    prefix = "CHQI" if direction == ChequeDirection.incoming else "CHQO"
    n = db.scalar(
        select(func.count()).select_from(Cheque).where(Cheque.direction == direction)
    ) or 0
    return f"{prefix}-{n + 1:06d}"


def _positive(amount) -> Decimal:
    value = to_money(amount)
    if value <= ZERO:
        raise ChequeError("قيمة الشيك لازم تكون أكبر من صفر.")
    return value


def register_cheque(
    db: Session, *, direction: ChequeDirection, cheque_number: str, amount, due_date: date,
    actor_user_id: int, issue_date: date | None = None, bank_name: str | None = None,
    customer_id: int | None = None, supplier_id: int | None = None,
    treasury_id: int | None = None, description: str | None = None,
) -> Cheque:
    """استلام شيك من عميل أو تحرير شيك لمورد — القيمة تدخل حساب الشيكات لا الخزينة."""
    value = _positive(amount)
    issued = issue_date or date.today()
    if due_date < issued:
        raise ChequeError("تاريخ الاستحقاق قبل تاريخ التحرير.")

    if direction == ChequeDirection.incoming:
        if customer_id is None:
            raise ChequeError("لازم تحدد العميل صاحب الشيك.")
        party = voucher_service._customer_account(db, customer_id)
        holding = under_collection_account(db)
        debit, credit = holding.id, party.account_id
        statement = "شيك وارد تحت التحصيل"
    else:
        if supplier_id is None:
            raise ChequeError("لازم تحدد المورد المستفيد.")
        party = voucher_service._supplier_account(db, supplier_id)
        holding = cheques_payable_account(db)
        debit, credit = party.account_id, holding.id
        statement = "شيك صادر تحت الدفع"

    cheque = Cheque(
        document_number=_doc_number(db, direction), direction=direction,
        status=ChequeStatus.pending, cheque_number=cheque_number.strip(), bank_name=bank_name,
        amount=value, issue_date=issued, due_date=due_date, customer_id=customer_id,
        supplier_id=supplier_id, treasury_id=treasury_id, description=description,
        actor_user_id=actor_user_id,
    )
    db.add(cheque)
    db.flush()
    entry = ledger_service.post_entry(
        db, entry_type="cheque_register", actor_user_id=actor_user_id,
        description=description or statement, entry_date=issued,
        lines=[LineInput(debit, Direction.debit, value, statement=statement),
               LineInput(credit, Direction.credit, value, statement=statement)],
    )
    cheque.register_entry_id = entry.id
    db.flush()
    audit_service.record(db, action="cheque.register", actor_user_id=actor_user_id,
                         entity_type="cheque", entity_id=cheque.id,
                         after={"doc": cheque.document_number, "amount": str(value)})
    return cheque


def settle_cheque(
    db: Session, *, cheque_id: int, actor_user_id: int, settled_on: date | None = None,
    treasury_id: int | None = None,
) -> Cheque:
    """تحصيل شيك وارد أو صرف شيك صادر — هنا فقط تتحرك الخزينة."""
    cheque = db.get(Cheque, cheque_id)
    if cheque is None:
        raise ChequeError("الشيك غير موجود.")
    if cheque.status != ChequeStatus.pending:
        raise ChequeError("الشيك ليس تحت التحصيل/الدفع.")
    when = settled_on or date.today()
    treasury = treasury_service.resolve(db, treasury_id or cheque.treasury_id)

    if cheque.direction == ChequeDirection.incoming:
        holding = under_collection_account(db)
        debit, credit = treasury.account_id, holding.id
        statement = "تحصيل شيك"
    else:
        holding = cheques_payable_account(db)
        available = ledger_service.balance_of(db, treasury.account_id)
        if to_money(cheque.amount) > available:
            raise ChequeError(
                f"رصيد الخزينة غير كافٍ لصرف الشيك — المتاح {available}."
            )
        debit, credit = holding.id, treasury.account_id
        statement = "صرف شيك"

    entry = ledger_service.post_entry(
        db, entry_type="cheque_settle", actor_user_id=actor_user_id, description=statement,
        entry_date=when,
        lines=[LineInput(debit, Direction.debit, cheque.amount, statement=statement),
               LineInput(credit, Direction.credit, cheque.amount, statement=statement)],
    )
    cheque.settle_entry_id = entry.id
    cheque.settled_on = when
    cheque.treasury_id = treasury.id
    cheque.status = ChequeStatus.settled
    db.flush()
    audit_service.record(db, action="cheque.settle", actor_user_id=actor_user_id,
                         entity_type="cheque", entity_id=cheque.id,
                         after={"doc": cheque.document_number, "on": str(when)})
    return cheque


def bounce_cheque(db: Session, *, cheque_id: int, actor_user_id: int,
                  on: date | None = None) -> Cheque:
    """ارتداد شيك وارد — القيمة ترجع مديونية على العميل."""
    cheque = db.get(Cheque, cheque_id)
    if cheque is None:
        raise ChequeError("الشيك غير موجود.")
    if cheque.direction != ChequeDirection.incoming:
        raise ChequeError("الارتداد للشيكات الواردة فقط.")
    if cheque.status != ChequeStatus.pending:
        raise ChequeError("الشيك ليس تحت التحصيل.")
    when = on or date.today()
    party = voucher_service._customer_account(db, cheque.customer_id)
    holding = under_collection_account(db)
    entry = ledger_service.post_entry(
        db, entry_type="cheque_bounce", actor_user_id=actor_user_id,
        description="ارتداد شيك", entry_date=when,
        lines=[LineInput(party.account_id, Direction.debit, cheque.amount,
                         statement="ارتداد شيك"),
               LineInput(holding.id, Direction.credit, cheque.amount,
                         statement="ارتداد شيك")],
    )
    cheque.settle_entry_id = entry.id
    cheque.settled_on = when
    cheque.status = ChequeStatus.bounced
    db.flush()
    audit_service.record(db, action="cheque.bounce", actor_user_id=actor_user_id,
                         entity_type="cheque", entity_id=cheque.id,
                         after={"doc": cheque.document_number})
    return cheque


def unsettle_cheque(db: Session, *, cheque_id: int, actor_user_id: int) -> Cheque:
    """عكس تحصيل/صرف شيك — يعكس قيد التسوية ويرجّع الشيك «تحت التحصيل/الدفع».

    A settled cheque cannot be edited (append-only), so undoing a mistaken collection means
    reversing the settlement entry: the value leaves the treasury and returns to the holding
    account, and the cheque is pending again — ready to re-settle or bounce.
    """
    cheque = db.get(Cheque, cheque_id)
    if cheque is None:
        raise ChequeError("الشيك غير موجود.")
    if cheque.status != ChequeStatus.settled or cheque.settle_entry_id is None:
        raise ChequeError("لا يمكن عكس التسوية إلا لشيك مُحصَّل أو مصروف.")
    ledger_service.reverse_entry(db, original_id=cheque.settle_entry_id,
                                 actor_user_id=actor_user_id)
    cheque.settle_entry_id = None
    cheque.settled_on = None
    cheque.status = ChequeStatus.pending
    db.flush()
    audit_service.record(db, action="cheque.unsettle", actor_user_id=actor_user_id,
                         entity_type="cheque", entity_id=cheque.id,
                         before={"doc": cheque.document_number})
    return cheque


def cancel_cheque(db: Session, *, cheque_id: int, actor_user_id: int) -> Cheque:
    """إلغاء شيك لم يُحصَّل — يعكس قيد التسجيل."""
    cheque = db.get(Cheque, cheque_id)
    if cheque is None:
        raise ChequeError("الشيك غير موجود.")
    if cheque.status != ChequeStatus.pending:
        raise ChequeError("لا يمكن إلغاء شيك بعد تسويته.")
    ledger_service.reverse_entry(db, original_id=cheque.register_entry_id,
                                 actor_user_id=actor_user_id)
    cheque.status = ChequeStatus.cancelled
    db.flush()
    audit_service.record(db, action="cheque.cancel", actor_user_id=actor_user_id,
                         entity_type="cheque", entity_id=cheque.id,
                         before={"doc": cheque.document_number})
    return cheque


def list_cheques(
    db: Session, *, direction: ChequeDirection | None = None,
    status: ChequeStatus | None = None, customer_id: int | None = None,
    supplier_id: int | None = None, due_from: date | None = None,
    due_to: date | None = None,
) -> list[Cheque]:
    stmt = select(Cheque)
    if direction is not None:
        stmt = stmt.where(Cheque.direction == direction)
    if status is not None:
        stmt = stmt.where(Cheque.status == status)
    if customer_id is not None:
        stmt = stmt.where(Cheque.customer_id == customer_id)
    if supplier_id is not None:
        stmt = stmt.where(Cheque.supplier_id == supplier_id)
    if due_from is not None:
        stmt = stmt.where(Cheque.due_date >= due_from)
    if due_to is not None:
        stmt = stmt.where(Cheque.due_date <= due_to)
    return db.scalars(stmt.order_by(Cheque.due_date, Cheque.id)).all()
