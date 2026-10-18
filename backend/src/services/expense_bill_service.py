from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.branch_scope import branch_for
from src.core.money import to_money
from src.models.expense_bill import ExpenseBill, ExpenseBillLine
from src.models.ledger import Account, AccountNature, Direction, PartnerKind
from src.models.role import RoleName
from src.models.supplier import Supplier, SupplierAccount
from src.services import audit_service, ledger_service
from src.services.ledger_service import LineInput
from src.services.numbering import next_document_number

ZERO = Decimal("0.00")
ENTRY_TYPE = "expense_bill"


class ExpenseBillError(Exception):
    pass


@dataclass
class BillLineInput:
    account_id: int
    amount: object
    description: str | None = None
    cost_center_id: int | None = None


def _nature(acc: Account) -> AccountNature | None:
    from src.services.financial_reports_service import effective_nature

    return effective_nature(acc)


def _expense_account(db: Session, account_id: int) -> Account:
    acc = db.get(Account, account_id)
    if acc is None or not acc.active:
        raise ExpenseBillError("حساب المصروف غير موجود.")
    if _nature(acc) != AccountNature.expense:
        raise ExpenseBillError(f"«{acc.name or acc.code}» ليس حساب مصروفات.")
    if not acc.is_postable:
        raise ExpenseBillError(f"«{acc.name or acc.code}» حساب تجميعي — اختر حسابًا فرعيًا.")
    return acc


def _creditor(db: Session, supplier_id: int | None,
              account_id: int | None) -> tuple[Account, Supplier | None]:
    if supplier_id:
        supplier = db.get(Supplier, supplier_id)
        if supplier is None:
            raise ExpenseBillError("المورد غير موجود.")
        link = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == supplier_id))
        if link is None:
            raise ExpenseBillError("المورد ليس له حساب ذمم.")
        return db.get(Account, link.account_id), supplier
    if not account_id:
        raise ExpenseBillError("اختر الطرف المستحق: مورد أو حساب.")
    acc = db.get(Account, account_id)
    if acc is None or not acc.active:
        raise ExpenseBillError("حساب الطرف المستحق غير موجود.")
    if not acc.is_postable:
        raise ExpenseBillError("حساب الطرف المستحق تجميعي — اختر حسابًا فرعيًا.")
    if _nature(acc) not in (AccountNature.liability, AccountNature.asset):
        raise ExpenseBillError("الطرف المستحق يجب أن يكون حساب التزامات (مثل الأجور المستحقة).")
    return acc, None


def _prepare(db: Session, *, lines: list[BillLineInput], supplier_id: int | None,
             creditor_account_id: int | None, cash_amount, treasury_id: int | None,
             actor_user_id: int, actor_role: RoleName) -> dict:
    if not lines:
        raise ExpenseBillError("أضف بند مصروف واحدًا على الأقل.")
    rows = []
    for ln in lines:
        value = to_money(ln.amount or 0)
        if value <= ZERO:
            raise ExpenseBillError("قيمة كل بند يجب أن تكون أكبر من صفر.")
        rows.append((_expense_account(db, ln.account_id), value, ln))
    total = to_money(sum((v for _, v, _ in rows), ZERO))
    cash = to_money(cash_amount or 0)
    if cash < ZERO:
        raise ExpenseBillError("المدفوع نقدًا لا يكون سالبًا.")
    if cash > total:
        raise ExpenseBillError(f"المدفوع نقدًا ({cash}) أكبر من إجمالي الفاتورة ({total}).")
    creditor, supplier = _creditor(db, supplier_id, creditor_account_id)
    cash_account_id = safe_id = None
    if cash > ZERO:
        from src.services import voucher_service

        try:
            cash_account_id, safe_id = voucher_service._cash_side(
                db, actor_role=actor_role, actor_user_id=actor_user_id, treasury_id=treasury_id)
        except voucher_service.VoucherError as exc:
            raise ExpenseBillError(str(exc)) from exc
    return {"rows": rows, "total": total, "cash": cash, "credit": to_money(total - cash),
            "creditor": creditor, "supplier": supplier,
            "cash_account_id": cash_account_id, "treasury_id": safe_id}


def _post(db: Session, bill: ExpenseBill, plan: dict, actor_user_id: int) -> None:
    supplier = plan["supplier"]
    party = supplier.name if supplier is not None else (plan["creditor"].name or "")
    lines = [LineInput(acc.id, Direction.debit, value,
                       statement=(ln.description or f"فاتورة مصروف {bill.document_number}"),
                       cost_center_id=ln.cost_center_id)
             for acc, value, ln in plan["rows"]]
    if plan["cash"] > ZERO:
        lines.append(LineInput(plan["cash_account_id"], Direction.credit, plan["cash"],
                               statement=f"فاتورة مصروف {bill.document_number} — نقدًا"))
    if plan["credit"] > ZERO:
        lines.append(LineInput(
            plan["creditor"].id, Direction.credit, plan["credit"],
            statement=f"فاتورة مصروف {bill.document_number} — {party}".strip(),
            partner_kind=PartnerKind.supplier if supplier is not None else None,
            partner_id=supplier.id if supplier is not None else None))
    entry = ledger_service.post_entry(
        db, entry_type=ENTRY_TYPE, actor_user_id=actor_user_id, lines=lines,
        description=f"فاتورة مصروف {bill.document_number} — {party}".strip(),
        branch_id=bill.branch_id, entry_date=bill.bill_date)
    bill.ledger_entry_id = entry.id


def _apply(bill: ExpenseBill, plan: dict, *, bill_date: date, external_document_number,
           notes) -> None:
    bill.bill_date = bill_date
    bill.supplier_id = plan["supplier"].id if plan["supplier"] is not None else None
    bill.creditor_account_id = plan["creditor"].id
    bill.total = plan["total"]
    bill.cash_amount = plan["cash"]
    bill.credit_amount = plan["credit"]
    bill.treasury_id = plan["treasury_id"]
    bill.cash_account_id = plan["cash_account_id"]
    bill.external_document_number = (external_document_number or "").strip() or None
    bill.notes = (notes or "").strip() or None
    bill.lines = [ExpenseBillLine(account_id=acc.id, amount=value,
                                  description=(ln.description or "").strip() or None,
                                  cost_center_id=ln.cost_center_id)
                  for acc, value, ln in plan["rows"]]


def snapshot(bill: ExpenseBill) -> dict:
    return {
        "document_number": bill.document_number, "bill_date": str(bill.bill_date),
        "supplier_id": bill.supplier_id, "creditor_account_id": bill.creditor_account_id,
        "total": str(bill.total), "cash_amount": str(bill.cash_amount),
        "treasury_id": bill.treasury_id,
        "lines": [{"account_id": ln.account_id, "amount": str(ln.amount),
                   "description": ln.description} for ln in bill.lines],
    }


def _branch(db: Session, plan: dict, *, actor_user_id: int, view_branch_id: int | None) -> int | None:
    found = branch_for(db, actor_user_id=actor_user_id) or view_branch_id
    if found is None and plan["treasury_id"]:
        from src.models.treasury import Treasury

        safe = db.get(Treasury, plan["treasury_id"])
        found = safe.branch_id if safe is not None else None
    if found is None and plan["supplier"] is not None:
        found = plan["supplier"].branch_id
    return found


def create(db: Session, *, lines: list[BillLineInput], supplier_id: int | None,
           creditor_account_id: int | None, cash_amount, treasury_id: int | None,
           bill_date: date | None, external_document_number: str | None, notes: str | None,
           actor_user_id: int, actor_role: RoleName,
           view_branch_id: int | None = None) -> ExpenseBill:
    plan = _prepare(db, lines=lines, supplier_id=supplier_id,
                    creditor_account_id=creditor_account_id, cash_amount=cash_amount,
                    treasury_id=treasury_id, actor_user_id=actor_user_id, actor_role=actor_role)
    if plan["cash"] > ZERO:
        available = ledger_service.balance_of(db, plan["cash_account_id"])
        if plan["cash"] > available:
            raise ExpenseBillError(
                f"الرصيد النقدي غير كافٍ — المتاح {available} والمطلوب صرفه {plan['cash']}.")
    bill = ExpenseBill(document_number=next_document_number(db, ExpenseBill, "EXB"),
                       branch_id=_branch(db, plan, actor_user_id=actor_user_id,
                                         view_branch_id=view_branch_id),
                       actor_user_id=actor_user_id, bill_date=bill_date or date.today(),
                       creditor_account_id=plan["creditor"].id, total=ZERO,
                       cash_amount=ZERO, credit_amount=ZERO)
    _apply(bill, plan, bill_date=bill_date or date.today(),
           external_document_number=external_document_number, notes=notes)
    db.add(bill)
    db.flush()
    _post(db, bill, plan, actor_user_id)
    db.flush()
    audit_service.record(db, action="expense_bill.create", actor_user_id=actor_user_id,
                         entity_type="expense_bill", entity_id=bill.id, after=snapshot(bill))
    return bill


def _drop(db: Session, bill: ExpenseBill) -> None:
    from src.services.document_edit_service import DocumentEditError, _drop_entry

    entry_id = bill.ledger_entry_id
    bill.ledger_entry_id = None
    db.flush()
    try:
        _drop_entry(db, entry_id)
    except DocumentEditError as exc:
        raise ExpenseBillError(str(exc)) from exc


def update(db: Session, bill: ExpenseBill, *, lines: list[BillLineInput],
           supplier_id: int | None, creditor_account_id: int | None, cash_amount,
           treasury_id: int | None, bill_date: date | None,
           external_document_number: str | None, notes: str | None,
           actor_user_id: int, actor_role: RoleName,
           view_branch_id: int | None = None) -> ExpenseBill:
    before = snapshot(bill)
    plan = _prepare(db, lines=lines, supplier_id=supplier_id,
                    creditor_account_id=creditor_account_id, cash_amount=cash_amount,
                    treasury_id=treasury_id, actor_user_id=actor_user_id, actor_role=actor_role)
    _drop(db, bill)
    if bill.branch_id is None:
        bill.branch_id = _branch(db, plan, actor_user_id=actor_user_id,
                                 view_branch_id=view_branch_id)
    _apply(bill, plan, bill_date=bill_date or bill.bill_date,
           external_document_number=external_document_number, notes=notes)
    db.flush()
    _post(db, bill, plan, actor_user_id)
    db.flush()
    audit_service.record(db, action="expense_bill.update", actor_user_id=actor_user_id,
                         entity_type="expense_bill", entity_id=bill.id,
                         before=before, after=snapshot(bill))
    return bill


def delete(db: Session, bill: ExpenseBill, *, actor_user_id: int) -> None:
    before = snapshot(bill)
    _drop(db, bill)
    audit_service.record(db, action="expense_bill.delete", actor_user_id=actor_user_id,
                         entity_type="expense_bill", entity_id=bill.id, before=before)
    db.delete(bill)
    db.flush()
