from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.core.money import to_money
from src.models.customer import Customer
from src.models.ledger import Account, Direction, PartnerKind
from src.models.settlement_discount import SettlementDiscount
from src.models.supplier import Supplier
from src.services import audit_service, ledger_service
from src.services.ledger_service import LineInput
from src.services.numbering import next_document_number

ZERO = Decimal("0.00")
ENTRY_TYPE = "settlement_discount"
KINDS = {"allowed": "خصم مسموح به", "earned": "خصم مكتسب"}
PREFIX = {"allowed": "DSA", "earned": "DSE"}


class DiscountError(Exception):
    pass


def _group_ids(db: Session, kind: str, branch_id: int | None) -> list[int]:
    stmt = select(Account.id).where(Account.name == KINDS[kind], Account.is_postable.is_(False))
    if branch_id is not None:
        stmt = stmt.where(Account.branch_id == branch_id)
    return list(db.scalars(stmt).all())


def discount_accounts(db: Session, kind: str, branch_id: int | None) -> list[Account]:
    if kind not in KINDS:
        raise DiscountError("نوع الخصم غير معروف.")
    frontier = _group_ids(db, kind, branch_id)
    found: list[Account] = []
    seen: set[int] = set()
    while frontier:
        kids = db.scalars(select(Account).where(Account.parent_id.in_(frontier))).all()
        frontier = []
        for a in kids:
            if a.id in seen:
                continue
            seen.add(a.id)
            if a.is_postable:
                if a.active:
                    found.append(a)
            else:
                frontier.append(a.id)
    return sorted(found, key=lambda a: ("خصم" not in (a.name or ""), a.name or ""))


def _party(db: Session, kind: str, customer_id: int | None, supplier_id: int | None):
    from src.services import voucher_service

    try:
        if kind == "allowed":
            if not customer_id:
                raise DiscountError("اختر العميل.")
            customer = db.get(Customer, customer_id)
            accounts = voucher_service._customer_accounts(db, customer_id)
            if customer is None or not accounts:
                raise DiscountError("العميل ليس له حساب ذمم.")
            return customer, accounts
        if not supplier_id:
            raise DiscountError("اختر المورد.")
        link = voucher_service._supplier_account(db, supplier_id)
        return db.get(Supplier, supplier_id), [link]
    except voucher_service.VoucherError as exc:
        raise DiscountError(str(exc)) from exc


def default_account(db: Session, kind: str, branch_id: int | None,
                    party_name: str | None) -> Account | None:
    options = discount_accounts(db, kind, branch_id)
    name = (party_name or "").strip()
    for a in options:
        if name and (a.name or "").strip() == name:
            return a
    for words in (("خصم", "عام"), ("خصم",)):
        for a in options:
            if all(w in (a.name or "") for w in words):
                return a
    return options[0] if len(options) == 1 else None


def party_branch(db: Session, kind: str, customer_id: int | None,
                 supplier_id: int | None) -> tuple[object, list, int | None]:
    party, links = _party(db, kind, customer_id, supplier_id)
    accounts = [db.get(Account, ln.account_id) for ln in links]
    branch_id = next((a.branch_id for a in accounts if a is not None and a.branch_id),
                     getattr(party, "branch_id", None))
    return party, links, branch_id


def _prepare(db: Session, *, kind: str, customer_id: int | None, supplier_id: int | None,
             amount, discount_account_id: int | None) -> dict:
    if kind not in KINDS:
        raise DiscountError("نوع الخصم غير معروف.")
    value = to_money(amount or 0)
    if value <= ZERO:
        raise DiscountError("قيمة الخصم يجب أن تكون أكبر من صفر.")
    party, links, branch_id = party_branch(db, kind, customer_id, supplier_id)
    if discount_account_id:
        if discount_account_id not in {a.id for a in discount_accounts(db, kind, branch_id)}:
            raise DiscountError(f"الحساب المختار ليس من حسابات «{KINDS[kind]}» في فرع الطرف.")
        disc = db.get(Account, discount_account_id)
    else:
        disc = default_account(db, kind, branch_id, party.name)
        if disc is None:
            raise DiscountError(f"اختر حساب «{KINDS[kind]}».")
    return {"kind": kind, "value": value, "party": party, "links": links,
            "branch_id": branch_id, "discount": disc}


def _split(db: Session, plan: dict) -> list[tuple[int, Decimal]]:
    from src.services import voucher_service

    links = plan["links"]
    if len(links) == 1:
        return [(links[0].account_id, plan["value"])]
    return [(a.account_id, v) for a, v in voucher_service._split_across_lines(
        db, links, plan["value"])]


def _post(db: Session, doc: SettlementDiscount, plan: dict, actor_user_id: int) -> None:
    party = plan["party"]
    label = f"{KINDS[doc.kind]} {doc.document_number} — {party.name}"
    statement = doc.notes or label
    if doc.kind == "allowed":
        lines = [LineInput(plan["discount"].id, Direction.debit, plan["value"],
                           statement=statement)]
        lines += [LineInput(acc, Direction.credit, v, statement=statement,
                            partner_kind=PartnerKind.customer, partner_id=party.id)
                  for acc, v in _split(db, plan)]
    else:
        lines = [LineInput(acc, Direction.debit, v, statement=statement,
                           partner_kind=PartnerKind.supplier, partner_id=party.id)
                 for acc, v in _split(db, plan)]
        lines.append(LineInput(plan["discount"].id, Direction.credit, plan["value"],
                               statement=statement))
    entry = ledger_service.post_entry(
        db, entry_type=ENTRY_TYPE, actor_user_id=actor_user_id, lines=lines,
        description=label, branch_id=doc.branch_id, entry_date=doc.discount_date)
    doc.ledger_entry_id = entry.id


def _apply(doc: SettlementDiscount, plan: dict, *, discount_date: date,
           external_document_number, notes) -> None:
    doc.kind = plan["kind"]
    doc.branch_id = plan["branch_id"]
    doc.discount_date = discount_date
    doc.customer_id = plan["party"].id if plan["kind"] == "allowed" else None
    doc.supplier_id = plan["party"].id if plan["kind"] == "earned" else None
    doc.discount_account_id = plan["discount"].id
    doc.amount = plan["value"]
    doc.external_document_number = (external_document_number or "").strip() or None
    doc.notes = (notes or "").strip() or None


def snapshot(doc: SettlementDiscount) -> dict:
    return {"document_number": doc.document_number, "kind": doc.kind,
            "discount_date": str(doc.discount_date), "customer_id": doc.customer_id,
            "supplier_id": doc.supplier_id, "discount_account_id": doc.discount_account_id,
            "amount": str(doc.amount), "notes": doc.notes}


def create(db: Session, *, kind: str, customer_id: int | None, supplier_id: int | None,
           amount, discount_account_id: int | None, discount_date: date | None,
           external_document_number: str | None, notes: str | None,
           actor_user_id: int) -> SettlementDiscount:
    plan = _prepare(db, kind=kind, customer_id=customer_id, supplier_id=supplier_id,
                    amount=amount, discount_account_id=discount_account_id)
    day = discount_date or date.today()
    doc = SettlementDiscount(
        document_number=next_document_number(db, SettlementDiscount, PREFIX[kind]),
        kind=kind, discount_date=day, discount_account_id=plan["discount"].id,
        amount=plan["value"], actor_user_id=actor_user_id)
    _apply(doc, plan, discount_date=day, external_document_number=external_document_number,
           notes=notes)
    db.add(doc)
    db.flush()
    _post(db, doc, plan, actor_user_id)
    db.flush()
    audit_service.record(db, action="settlement_discount.create", actor_user_id=actor_user_id,
                         entity_type="settlement_discount", entity_id=doc.id,
                         after=snapshot(doc))
    return doc


def _drop(db: Session, doc: SettlementDiscount) -> None:
    from src.services.document_edit_service import DocumentEditError, _drop_entry

    entry_id = doc.ledger_entry_id
    doc.ledger_entry_id = None
    db.flush()
    if entry_id is None:
        return
    try:
        _drop_entry(db, entry_id)
    except DocumentEditError as exc:
        raise DiscountError(str(exc)) from exc


def update(db: Session, doc: SettlementDiscount, *, customer_id: int | None,
           supplier_id: int | None, amount, discount_account_id: int | None,
           discount_date: date | None, external_document_number: str | None,
           notes: str | None, actor_user_id: int) -> SettlementDiscount:
    before = snapshot(doc)
    plan = _prepare(db, kind=doc.kind, customer_id=customer_id, supplier_id=supplier_id,
                    amount=amount, discount_account_id=discount_account_id)
    _drop(db, doc)
    _apply(doc, plan, discount_date=discount_date or doc.discount_date,
           external_document_number=external_document_number, notes=notes)
    db.flush()
    _post(db, doc, plan, actor_user_id)
    db.flush()
    audit_service.record(db, action="settlement_discount.update", actor_user_id=actor_user_id,
                         entity_type="settlement_discount", entity_id=doc.id,
                         before=before, after=snapshot(doc))
    return doc


def delete(db: Session, doc: SettlementDiscount, *, actor_user_id: int) -> None:
    before = snapshot(doc)
    _drop(db, doc)
    audit_service.record(db, action="settlement_discount.delete", actor_user_id=actor_user_id,
                         entity_type="settlement_discount", entity_id=doc.id, before=before)
    db.delete(doc)
    db.flush()
