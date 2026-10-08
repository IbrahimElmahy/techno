from __future__ import annotations

from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.services import numbering

from src.core.money import ZERO, to_money
from src.models.customer import Customer, CustomerAccount
from src.services import customer_merge_service
from src.services.customer_merge_service import MergeError
from src.models.ledger import Account, AccountNature, AccountType, Direction, LedgerEntry, PartnerKind
from src.models.role import RoleName
from src.models.supplier import Supplier, SupplierAccount
from src.models.user import User
from src.models.voucher import Voucher, VoucherKind
from src.models.warehouse import Custody
from src.services import account_resolver, audit_service, ledger_service, treasury_service
from src.services.ledger_service import LineInput
from src.auth.branch_scope import branch_for

_PREFIX = {
    VoucherKind.receipt: "RCV",
    VoucherKind.payment: "PAY",
    VoucherKind.rep_handover: "HND",
    VoucherKind.expense: "EXP",
    VoucherKind.cash_transfer: "TRF",
    VoucherKind.partner_withdraw: "PWD",
    VoucherKind.partner_deposit: "PDP",
}


class VoucherError(Exception):
    pass


def _doc_number(db: Session, kind: VoucherKind) -> str:
    return numbering.next_document_number(
        db, Voucher, _PREFIX[kind], where=Voucher.kind == kind)


def _positive(amount) -> Decimal:
    value = to_money(amount)
    if value <= ZERO:
        raise VoucherError("قيمة السند لازم تكون أكبر من صفر.")
    return value


def _customer_account(db: Session, customer_id: int, family: str | None = None) -> CustomerAccount:
    if db.get(Customer, customer_id) is None:
        raise VoucherError("العميل غير موجود.")
    try:
        acc = customer_merge_service.receivable_account(db, customer_id, family)
    except MergeError as exc:
        raise VoucherError(str(exc)) from exc
    if acc is None:
        raise VoucherError("العميل ليس له حساب ذمم.")
    return acc


def _customer_accounts(db: Session, customer_id: int) -> list[CustomerAccount]:
    return list(db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == customer_id)).all())


def _split_across_lines(db: Session, accounts: list[CustomerAccount], amount: Decimal):
    owing = [(a, to_money(ledger_service.balance_of(db, a.account_id))) for a in accounts]
    balances = [(a, b) for a, b in owing if b > ZERO]
    total = sum((b for _, b in balances), ZERO)
    if total <= ZERO:
        main = sorted(accounts, key=lambda a: a.id)[0]
        return [(main, to_money(amount))]
    out = []
    running = ZERO
    for acc, bal in balances[:-1]:
        share = to_money(amount * bal / total)
        running += share
        out.append((acc, share))
    out.append((balances[-1][0], to_money(amount - running)))
    return [(a, v) for a, v in out if v > ZERO]


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
    family: str | None = None,
    credit_split: list[tuple[int, Decimal]] | None = None,
    client_uuid: str | None = None,
    cost_center_id: int | None = None,
    cost_center_distribution: dict | None = None,
    statement1: str | None = None,
    external_document_number: str | None = None,
    replacing: dict | None = None,
) -> Voucher:
    voucher = Voucher(
        document_number=_doc_number(db, kind) if replacing is None
        else replacing["document_number"], kind=kind, amount=amount,
        customer_id=customer_id, supplier_id=supplier_id, rep_user_id=rep_user_id,
        cash_account_id=cash_account_id, party_account_id=party_account_id,
        treasury_id=treasury_id, to_treasury_id=to_treasury_id,
        cost_center_id=cost_center_id,
        voucher_date=voucher_date or date.today(), payment_method=payment_method,
        reference=reference, description=description, ledger_entry_id=None,
        reverses_id=reverses_id, actor_user_id=actor_user_id, family=family,
        statement1=statement1,
        external_document_number=external_document_number,
        branch_id=branch_for(db, actor_user_id=actor_user_id),
        client_uuid=client_uuid,
    )
    if replacing is not None:
        voucher.id = replacing["id"]
        voucher.client_uuid = replacing["client_uuid"]
        voucher.created_at = replacing["created_at"]
        voucher.branch_id = replacing["branch_id"]
    db.add(voucher)
    db.flush()
    if customer_id is not None:
        v_partner_kind, v_partner_id = PartnerKind.customer, customer_id
    elif supplier_id is not None:
        v_partner_kind, v_partner_id = PartnerKind.supplier, supplier_id
    else:
        v_partner_kind, v_partner_id = None, None
    entry = ledger_service.post_entry(
        db, entry_type=entry_type, actor_user_id=actor_user_id,
        description=description or statement,
        entry_date=voucher.voucher_date,
        rep_id=rep_user_id, branch_id=voucher.branch_id,
        partner_kind=v_partner_kind, partner_id=v_partner_id,
        cost_center_id=cost_center_id,
        cost_center_distribution=cost_center_distribution,
        lines=[
            LineInput(debit_account_id, Direction.debit, amount, statement=statement),
            *(
                [LineInput(acc_id, Direction.credit, part, statement=statement)
                 for acc_id, part in credit_split]
                if credit_split
                else [LineInput(credit_account_id, Direction.credit, amount, statement=statement)]
            ),
        ],
    )
    voucher.ledger_entry_id = entry.id
    db.flush()
    if replacing is not None:
        return voucher
    audit_service.record(
        db, action=f"voucher.{kind.value}", actor_user_id=actor_user_id,
        entity_type="voucher", entity_id=voucher.id,
        after={"doc": voucher.document_number, "amount": str(amount)},
    )
    return voucher


def _cash_side(
    db: Session, *, actor_role: RoleName, actor_user_id: int, treasury_id: int | None,
    family: str | None = None,
) -> tuple[int, int | None]:
    if actor_role == RoleName.sales_rep:
        return account_resolver.resolve_cash_account(
            db, role=actor_role, user_id=actor_user_id, family=family).id, None
    if treasury_id is None:
        from src.models.treasury import Treasury
        from src.models.user import User

        user = db.get(User, actor_user_id)
        if user is not None and user.branch_id:
            own = db.scalar(select(Treasury).where(
                Treasury.branch_id == user.branch_id, Treasury.active.is_(True)
            ).order_by(Treasury.id))
            if own is not None:
                return own.account_id, own.id
    treasury = treasury_service.resolve(db, treasury_id)
    return treasury.account_id, treasury.id


def _receipt_rep(
    db: Session, *, customer_id: int, actor_user_id: int, actor_role: RoleName,
    rep_user_id: int | None,
) -> int | None:
    if actor_role == RoleName.sales_rep:
        return actor_user_id
    if rep_user_id is not None:
        if db.get(User, rep_user_id) is None:
            raise VoucherError("المندوب غير موجود.")
        return rep_user_id
    customer = db.get(Customer, customer_id)
    return customer.rep_id if customer is not None else None


def create_receipt(
    db: Session, *, customer_id: int | None = None, amount, actor_user_id: int,
    actor_role: RoleName, supplier_id: int | None = None, account_id: int | None = None,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None, payment_method: str | None = None,
    treasury_id: int | None = None, family: str | None = None,
    on_total: bool = False, client_uuid: str | None = None,
    cost_center_id: int | None = None, statement1: str | None = None,
    external_document_number: str | None = None,
    rep_user_id: int | None = None,
    replacing: dict | None = None,
) -> Voucher:
    value = _positive(amount)
    if len([x for x in (customer_id, supplier_id, account_id) if x]) != 1:
        raise VoucherError("اختار طرف واحد للسند: عميل أو مورد أو حساب.")
    if customer_id is None:
        return _party_voucher(
            db, receipt=True, value=value, supplier_id=supplier_id, account_id=account_id,
            actor_user_id=actor_user_id, actor_role=actor_role, treasury_id=treasury_id,
            voucher_date=voucher_date, description=description, reference=reference,
            payment_method=payment_method, cost_center_id=cost_center_id,
            statement1=statement1, external_document_number=external_document_number,
            replacing=replacing)
    rep_id = _receipt_rep(db, customer_id=customer_id, actor_user_id=actor_user_id,
                          actor_role=actor_role, rep_user_id=rep_user_id)
    cash_account_id, safe_id = _cash_side(
        db, actor_role=actor_role, actor_user_id=actor_user_id, treasury_id=treasury_id,
        family=family)

    accounts = _customer_accounts(db, customer_id)
    if on_total and family is None and len(accounts) > 1:
        parts = _split_across_lines(db, accounts, value)
        return _create(
            db, kind=VoucherKind.receipt, amount=value, cash_account_id=cash_account_id,
            party_account_id=max(parts, key=lambda p: p[1])[0].account_id,
            debit_account_id=cash_account_id,
            credit_account_id=parts[0][0].account_id, actor_user_id=actor_user_id,
            voucher_date=voucher_date, description=description, reference=reference,
            payment_method=payment_method, entry_type="receipt",
            statement="تحصيل من عميل — على إجمالي المديونية",
            customer_id=customer_id, treasury_id=safe_id,
            credit_split=[(a.account_id, v) for a, v in parts],
            family=None,
            client_uuid=client_uuid, statement1=statement1, external_document_number=external_document_number,
            cost_center_id=cost_center_id, rep_user_id=rep_id, replacing=replacing,
        )

    party = _customer_account(db, customer_id, family)
    return _create(
        db, kind=VoucherKind.receipt, amount=value, cash_account_id=cash_account_id,
        party_account_id=party.account_id, debit_account_id=cash_account_id,
        credit_account_id=party.account_id, actor_user_id=actor_user_id,
        voucher_date=voucher_date, description=description, reference=reference,
        payment_method=payment_method, entry_type="receipt",
        statement="تحصيل من عميل" + (f" — {family}" if family else ""),
        customer_id=customer_id, treasury_id=safe_id, family=family,
        client_uuid=client_uuid, rep_user_id=rep_id,
        cost_center_id=cost_center_id, statement1=statement1, external_document_number=external_document_number,
        replacing=replacing,
    )


_CUSTOMER_ROLE = {"employee": "موظف", "internal": "فرع", "owner": "مالك"}


def _party_voucher(
    db: Session, *, receipt: bool, value: Decimal, actor_user_id: int, actor_role: RoleName,
    customer_id: int | None = None, supplier_id: int | None = None,
    account_id: int | None = None, family: str | None = None,
    treasury_id: int | None = None, voucher_date: date | None = None,
    description: str | None = None, reference: str | None = None,
    payment_method: str | None = None, cost_center_id: int | None = None,
    statement1: str | None = None, external_document_number: str | None = None,
    replacing: dict | None = None,
) -> Voucher:
    given = [x for x in (customer_id, supplier_id, account_id) if x]
    if len(given) != 1:
        raise VoucherError("اختار طرف واحد للسند: عميل أو مورد أو حساب.")
    party_name = ""
    if customer_id:
        cust = db.get(Customer, customer_id)
        if cust is None:
            raise VoucherError("العميل غير موجود.")
        party_account = _customer_account(db, customer_id, family).account_id
        role = _CUSTOMER_ROLE.get(str(getattr(cust.customer_type, "value", cust.customer_type)),
                                  "عميل")
        party_name = f"{role} {cust.name}"
    elif supplier_id:
        sup = db.get(Supplier, supplier_id)
        party_account = _supplier_account(db, supplier_id).account_id
        party_name = f"مورد {sup.name if sup else ''}"
    else:
        acc = db.get(Account, account_id)
        if acc is None or not acc.active:
            raise VoucherError("الحساب غير موجود.")
        if not acc.is_postable:
            raise VoucherError("لا يمكن الترحيل على حساب تجميعي — اختر حسابًا فرعيًا.")
        if acc.account_type == AccountType.treasury:
            raise VoucherError("ده حساب خزنة — النقل بين الخزن بـ«تحويل نقدي».")
        party_account = acc.id
        party_name = acc.name or acc.code or ""
    cash_account_id, safe_id = _cash_side(
        db, actor_role=actor_role, actor_user_id=actor_user_id, treasury_id=treasury_id,
        family=family)
    if not receipt:
        _assert_cash_available(db, cash_account_id, value)
    kind = VoucherKind.receipt if receipt else VoucherKind.payment
    return _create(
        db, kind=kind, amount=value, cash_account_id=cash_account_id,
        party_account_id=party_account,
        debit_account_id=cash_account_id if receipt else party_account,
        credit_account_id=party_account if receipt else cash_account_id,
        actor_user_id=actor_user_id, voucher_date=voucher_date,
        description=description or f"{'قبض من' if receipt else 'صرف إلى'} {party_name}".strip(),
        reference=reference, payment_method=payment_method,
        entry_type="receipt" if receipt else "payment",
        statement=f"{'قبض من' if receipt else 'صرف إلى'} {party_name}".strip(),
        customer_id=customer_id, supplier_id=supplier_id, treasury_id=safe_id,
        family=family if customer_id else None,
        cost_center_id=cost_center_id, statement1=statement1,
        external_document_number=external_document_number, replacing=replacing,
    )


def _assert_cash_available(db: Session, account_id: int, value: Decimal) -> None:
    available = ledger_service.balance_of(db, account_id)
    if value > available:
        raise VoucherError(
            f"الرصيد النقدي غير كافٍ — المتاح {available} والمطلوب صرفه {value}."
        )


def create_payment(
    db: Session, *, supplier_id: int | None = None, amount, actor_user_id: int,
    actor_role: RoleName, customer_id: int | None = None, account_id: int | None = None,
    family: str | None = None,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None, payment_method: str | None = None,
    treasury_id: int | None = None,
    cost_center_id: int | None = None, statement1: str | None = None,
    external_document_number: str | None = None,
    replacing: dict | None = None,
) -> Voucher:
    value = _positive(amount)
    if len([x for x in (customer_id, supplier_id, account_id) if x]) != 1:
        raise VoucherError("اختار طرف واحد للسند: عميل أو مورد أو حساب.")
    if supplier_id is None:
        return _party_voucher(
            db, receipt=False, value=value, customer_id=customer_id, account_id=account_id,
            family=family, actor_user_id=actor_user_id, actor_role=actor_role,
            treasury_id=treasury_id, voucher_date=voucher_date, description=description,
            reference=reference, payment_method=payment_method, cost_center_id=cost_center_id,
            statement1=statement1, external_document_number=external_document_number,
            replacing=replacing)
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
        cost_center_id=cost_center_id, statement1=statement1, external_document_number=external_document_number,
        replacing=replacing,
    )


def create_expense(
    db: Session, *, expense_account_id: int, amount, actor_user_id: int,
    actor_role: RoleName, voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None, payment_method: str | None = None,
    treasury_id: int | None = None,
    cost_center_id: int | None = None,
    cost_center_distribution: dict | None = None, statement1: str | None = None,
    external_document_number: str | None = None,
) -> Voucher:
    value = _positive(amount)
    account = db.get(Account, expense_account_id)
    if account is None or not account.active:
        raise VoucherError("حساب المصروف غير موجود.")
    from src.services.financial_reports_service import effective_nature

    if effective_nature(account) != AccountNature.expense:
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
        cost_center_id=cost_center_id,
        cost_center_distribution=cost_center_distribution, statement1=statement1,
        external_document_number=external_document_number,
    )


def create_partner_movement(
    db: Session, *, account_id: int, withdraw: bool, amount, actor_user_id: int,
    actor_role: RoleName, treasury_id: int | None = None, voucher_date: date | None = None,
    description: str | None = None, statement1: str | None = None,
    external_document_number: str | None = None,
) -> Voucher:
    value = _positive(amount)
    acc = db.get(Account, account_id)
    parent = db.get(Account, acc.parent_id) if acc is not None and acc.parent_id else None
    pname = (parent.name or "") if parent is not None else ""
    if acc is None or not acc.active or not acc.is_postable or not any(
            w in pname for w in ("جار", "رأس المال", "راس المال", "استثمار")):
        raise VoucherError("الحساب لازم يكون حساب شريك تحت «جارى الشركاء» أو «رأس المال».")
    cash_account_id, safe_id = _cash_side(
        db, actor_role=actor_role, actor_user_id=actor_user_id, treasury_id=treasury_id)
    if withdraw:
        _assert_cash_available(db, cash_account_id, value)
    kind = VoucherKind.partner_withdraw if withdraw else VoucherKind.partner_deposit
    label = "سحب شريك" if withdraw else "إيداع شريك"
    v = _create(
        db, kind=kind, amount=value, cash_account_id=cash_account_id,
        party_account_id=acc.id,
        debit_account_id=acc.id if withdraw else cash_account_id,
        credit_account_id=cash_account_id if withdraw else acc.id,
        actor_user_id=actor_user_id, voucher_date=voucher_date, description=description,
        reference=None, payment_method=None, entry_type=kind.value,
        statement=f"{label} — {acc.name or acc.code or ''} ({pname})".strip(),
        treasury_id=safe_id, statement1=statement1,
        external_document_number=external_document_number,
    )
    if v.branch_id is None and acc.branch_id is not None:
        v.branch_id = acc.branch_id
        entry = db.get(LedgerEntry, v.ledger_entry_id)
        if entry is not None and entry.branch_id is None:
            entry.branch_id = acc.branch_id
        db.flush()
    return v


def create_cash_transfer(
    db: Session, *, from_treasury_id: int, to_treasury_id: int, amount, actor_user_id: int,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None,
    cost_center_id: int | None = None, statement1: str | None = None,
    external_document_number: str | None = None,
) -> Voucher:
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
        cost_center_id=cost_center_id, statement1=statement1, external_document_number=external_document_number,
    )


def create_handover(
    db: Session, *, rep_user_id: int, amount, actor_user_id: int,
    voucher_date: date | None = None, description: str | None = None,
    reference: str | None = None, family: str | None = None,
    cost_center_id: int | None = None, statement1: str | None = None,
    external_document_number: str | None = None,
) -> Voucher:
    value = _positive(amount)
    if db.get(User, rep_user_id) is None:
        raise VoucherError("المندوب غير موجود.")
    try:
        custody_acc = account_resolver.resolve_cash_account(
            db, role=RoleName.sales_rep, user_id=rep_user_id, family=family)
    except account_resolver.AccountResolutionError as exc:
        raise VoucherError(str(exc)) from exc
    custody = SimpleNamespace(account_id=custody_acc.id)
    held = ledger_service.balance_of(db, custody.account_id)
    if value > held:
        raise VoucherError(f"رصيد عهدة المندوب {held} — لا يمكن توريد {value}.")
    from src.models.user import User

    rep_user = db.get(User, rep_user_id)
    treasury = account_resolver.treasury_account(
        db, branch_id=rep_user.branch_id if rep_user is not None else None)
    return _create(
        db, kind=VoucherKind.rep_handover, amount=value, cash_account_id=treasury.id,
        party_account_id=custody.account_id, debit_account_id=treasury.id,
        credit_account_id=custody.account_id, actor_user_id=actor_user_id,
        voucher_date=voucher_date, description=description, reference=reference,
        payment_method=None, entry_type="rep_handover", statement="توريد مندوب للخزينة",
        rep_user_id=rep_user_id,
        cost_center_id=cost_center_id, statement1=statement1, external_document_number=external_document_number,
    )


def invoice_cash_accounts(db: Session, invoices, *, direction: str) -> dict[int, int]:
    from src.models.ledger import Direction, LedgerLine

    by_entry = {i.ledger_entry_id: i for i in invoices if i.ledger_entry_id}
    if not by_entry:
        return {}
    want = Direction(direction)
    out: dict[int, int] = {}
    for line in db.scalars(select(LedgerLine).where(
            LedgerLine.entry_id.in_(list(by_entry)), LedgerLine.direction == want)).all():
        inv = by_entry[line.entry_id]
        if inv.id not in out and abs(Decimal(line.amount) - Decimal(inv.cash_amount or 0)) < Decimal("0.005"):
            out[inv.id] = line.account_id
    return out


def cash_labeler(db: Session, *, treasury_ids, account_ids):
    from sqlalchemy import or_
    from src.models.treasury import Treasury

    treasury_ids = {i for i in treasury_ids if i}
    account_ids = {i for i in account_ids if i}
    by_id: dict[int, str] = {}
    by_acc: dict[int, str] = {}
    if treasury_ids or account_ids:
        for tid, name, acc in db.execute(select(Treasury.id, Treasury.name, Treasury.account_id)
                                         .where(or_(Treasury.id.in_(treasury_ids),
                                                    Treasury.account_id.in_(account_ids)))).all():
            by_id[tid] = name
            by_acc[acc] = name
    missing = account_ids - set(by_acc)
    if missing:
        by_acc.update({i: n for i, n in db.execute(
            select(Account.id, Account.name).where(Account.id.in_(missing))).all() if n})

    def label(treasury_id, account_id) -> str | None:
        return by_id.get(treasury_id) or by_acc.get(account_id)
    return label


class VoucherNotFound(VoucherError):
    pass


def replace_voucher(
    db: Session, *, voucher_id: int, kind: VoucherKind, editor_user_id: int,
    editor_role: RoleName, fields: dict,
) -> Voucher:
    from src.models.role import Role
    from src.services.document_edit_service import DocumentEditError, _drop_entry

    original = db.get(Voucher, voucher_id)
    if original is None:
        raise VoucherNotFound("السند مش موجود.")
    if (original.client_uuid or "").startswith("a5:"):
        raise VoucherError("السند ده منقول من a5 — عدّله في a5 والمزامنة هتجيب التعديل.")
    if original.kind != kind:
        raise VoucherError("نوع السند مش مطابق.")
    if original.reverses_id is not None:
        raise VoucherError("لا يمكن تعديل سند عكسي.")
    if db.scalar(select(Voucher.id).where(Voucher.reverses_id == voucher_id)) is not None:
        raise VoucherError("السند معكوس — مايتعدّلش.")

    keep = {
        "id": original.id, "document_number": original.document_number,
        "client_uuid": original.client_uuid, "created_at": original.created_at,
        "branch_id": original.branch_id,
    }
    old_amount = str(original.amount)
    actor_id = original.actor_user_id
    actor = db.get(User, actor_id)
    role = db.get(Role, actor.role_id) if actor is not None else None
    actor_role = role.name if role is not None else editor_role
    if (actor_role == RoleName.sales_rep and fields.get("treasury_id") is not None
            and editor_role != RoleName.sales_rep):
        actor_role = editor_role

    entry_id = original.ledger_entry_id
    original.ledger_entry_id = None
    db.flush()
    try:
        _drop_entry(db, entry_id)
    except DocumentEditError as exc:
        raise VoucherError(str(exc)) from exc
    db.delete(original)
    db.flush()

    args = {k: v for k, v in fields.items() if k != "client_uuid"}
    if kind == VoucherKind.receipt:
        v = create_receipt(db, actor_user_id=actor_id, actor_role=actor_role,
                           replacing=keep, **args)
    else:
        v = create_payment(db, actor_user_id=actor_id, actor_role=actor_role,
                           replacing=keep, **args)
    audit_service.record(
        db, action="voucher.update", actor_user_id=editor_user_id,
        entity_type="voucher", entity_id=v.id,
        before={"doc": keep["document_number"], "amount": old_amount},
        after={"doc": v.document_number, "amount": str(v.amount)},
    )
    return v


def reverse_voucher(db: Session, *, voucher_id: int, actor_user_id: int) -> Voucher:
    original = db.get(Voucher, voucher_id)
    if original is None:
        raise VoucherError("السند غير موجود.")
    if original.reverses_id is not None:
        raise VoucherError("لا يمكن عكس سند عكسي.")
    if db.scalar(select(Voucher).where(Voucher.reverses_id == voucher_id)) is not None:
        raise VoucherError("السند معكوس بالفعل.")
    counter = ledger_service.reverse_entry(db, original_id=original.ledger_entry_id,
                                           actor_user_id=actor_user_id)
    mirror = Voucher(
        document_number=_doc_number(db, original.kind), kind=original.kind,
        amount=original.amount, customer_id=original.customer_id,
        supplier_id=original.supplier_id, rep_user_id=original.rep_user_id,
        cash_account_id=original.cash_account_id, party_account_id=original.party_account_id,
        treasury_id=original.treasury_id, to_treasury_id=original.to_treasury_id,
        voucher_date=date.today(), payment_method=original.payment_method,
        reference=original.reference, description=f"عكس {original.document_number}",
        statement1=getattr(original, "statement1", None),
        ledger_entry_id=counter.id, reverses_id=voucher_id, actor_user_id=actor_user_id,
        family=getattr(original, "family", None),
        cost_center_id=getattr(original, "cost_center_id", None),
        branch_id=getattr(original, "branch_id", None),
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
