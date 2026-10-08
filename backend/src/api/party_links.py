from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_CUSTOMER_READ, CAP_CUSTOMER_WRITE, CAP_VOUCHER_WRITE
from src.core.db import get_db
from src.core.money import to_money
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Direction
from src.models.org import Branch
from src.models.party_link import PartyGroup, PartyGroupMember
from src.models.supplier import Supplier, SupplierAccount
from src.services import audit_service, customer_merge_service, ledger_service
from src.services.ledger_service import LedgerError, LineInput

router = APIRouter(tags=["party-links"])

KINDS = ("customer", "supplier")
TYPE_ROLE = {"employee": "موظف", "internal": "فرع", "owner": "مالك"}


class MemberOut(BaseModel):
    kind: str
    ref_id: int
    name: str
    role: str
    code: str | None
    branch_name: str | None
    balance: Decimal
    lines: list[dict] = []


class GroupOut(BaseModel):
    id: int
    name: str
    branch_name: str | None
    members: list[MemberOut]
    owes_us: Decimal
    we_owe: Decimal
    net: Decimal


def _card(db: Session, kind: str, ref_id: int):
    model = Customer if kind == "customer" else Supplier
    return db.get(model, ref_id)


def _member_out(db: Session, kind: str, ref_id: int, branches: dict) -> MemberOut | None:
    card = _card(db, kind, ref_id)
    if card is None:
        return None
    lines: list[dict] = []
    if kind == "customer":
        total = Decimal("0")
        for ca in db.scalars(select(CustomerAccount).where(CustomerAccount.customer_id == card.id)):
            b = ledger_service.balance_of(db, ca.account_id)
            total += b
            lines.append({"family": ca.family, "account_id": ca.account_id, "balance": str(b)})
        ctype = str(getattr(card.customer_type, "value", card.customer_type) or "")
        role = TYPE_ROLE.get(ctype, "عميل")
    else:
        total = Decimal("0")
        for sa in db.scalars(select(SupplierAccount).where(SupplierAccount.supplier_id == card.id)):
            total += ledger_service.balance_of(db, sa.account_id)
        role = "مورد"
    return MemberOut(kind=kind, ref_id=card.id, name=card.name, role=role, code=card.code,
                     branch_name=branches.get(card.branch_id), balance=to_money(total), lines=lines)


def _group_out(db: Session, g: PartyGroup, branches: dict) -> GroupOut:
    members = []
    for m in db.scalars(select(PartyGroupMember).where(PartyGroupMember.group_id == g.id)
                        .order_by(PartyGroupMember.kind, PartyGroupMember.id)):
        mo = _member_out(db, m.kind, m.ref_id, branches)
        if mo is not None:
            members.append(mo)
    owes = sum((m.balance for m in members if m.kind == "customer"), Decimal("0"))
    owe = sum((m.balance for m in members if m.kind == "supplier"), Decimal("0"))
    return GroupOut(id=g.id, name=g.name, branch_name=branches.get(g.branch_id), members=members,
                    owes_us=to_money(owes), we_owe=to_money(owe), net=to_money(owes - owe))


def _visible(current: CurrentUser, branch_id: int | None) -> bool:
    bid = branch_scope.visible_branch_id(current)
    return bid is None or branch_id in (bid, None)


@router.get("/party-groups", response_model=list[GroupOut])
def list_groups(
    q: str | None = Query(None),
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> list[GroupOut]:
    branches = {b.id: b.name for b in db.scalars(select(Branch))}
    out = []
    for g in db.scalars(select(PartyGroup).order_by(PartyGroup.name)):
        if not _visible(current, g.branch_id):
            continue
        if q and q.strip() not in g.name:
            continue
        out.append(_group_out(db, g, branches))
    return out


class SuggestionOut(BaseModel):
    name: str
    branch_id: int | None
    branch_name: str | None
    customer: MemberOut
    supplier: MemberOut


@router.get("/party-groups/suggestions", response_model=list[SuggestionOut])
def suggestions(
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_READ)),
    db: Session = Depends(get_db),
) -> list[SuggestionOut]:
    branches = {b.id: b.name for b in db.scalars(select(Branch))}
    linked = {(m.kind, m.ref_id) for m in db.scalars(select(PartyGroupMember))}
    bid = branch_scope.visible_branch_id(current)
    sup_by_key: dict[tuple, list[Supplier]] = {}
    for s in db.scalars(select(Supplier).where(Supplier.active.is_(True))):
        if ("supplier", s.id) in linked or (bid is not None and s.branch_id not in (bid, None)):
            continue
        sup_by_key.setdefault((s.branch_id, customer_merge_service.match_key(s.name)), []).append(s)
    out: list[SuggestionOut] = []
    for c in db.scalars(select(Customer).where(Customer.active.is_(True))):
        if ("customer", c.id) in linked:
            continue
        key = customer_merge_service.match_key(c.name)
        hits = sup_by_key.get((c.branch_id, key)) or sup_by_key.get((None, key)) or []
        if len(hits) != 1:
            continue
        cm = _member_out(db, "customer", c.id, branches)
        sm = _member_out(db, "supplier", hits[0].id, branches)
        if cm and sm:
            out.append(SuggestionOut(name=c.name, branch_id=c.branch_id,
                                     branch_name=branches.get(c.branch_id), customer=cm, supplier=sm))
    out.sort(key=lambda s: (s.branch_name or "", s.name))
    return out


class MemberIn(BaseModel):
    kind: str = Field(pattern="^(customer|supplier)$")
    ref_id: int


class LinkIn(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    members: list[MemberIn] = Field(min_length=1)


@router.post("/party-groups", response_model=GroupOut, status_code=201)
def link(
    body: LinkIn,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_WRITE)),
    db: Session = Depends(get_db),
) -> GroupOut:
    cards = []
    for m in body.members:
        card = _card(db, m.kind, m.ref_id)
        if card is None:
            raise HTTPException(404, {"code": "not_found", "message": "الكارت غير موجود."})
        if not _visible(current, card.branch_id):
            raise HTTPException(403, {"code": "forbidden", "message": "هذا الكارت في فرع آخر."})
        cards.append((m, card))
    existing = {m.group_id for m in db.scalars(select(PartyGroupMember).where(
        PartyGroupMember.kind.in_(KINDS))) if (m.kind, m.ref_id) in
        {(x.kind, x.ref_id) for x, _c in cards}}
    if len(existing) > 1:
        raise HTTPException(409, {"code": "conflict",
                                  "message": "هذه الكروت مرتبطة بأطراف مختلفة — فك ربط أحدها أولاً."})
    if existing:
        g = db.get(PartyGroup, existing.pop())
    else:
        first = cards[0][1]
        g = PartyGroup(name=(body.name or first.name)[:160], branch_id=first.branch_id)
        db.add(g)
        db.flush()
    have = {(m.kind, m.ref_id) for m in db.scalars(
        select(PartyGroupMember).where(PartyGroupMember.group_id == g.id))}
    for m, _card_ in cards:
        if (m.kind, m.ref_id) not in have:
            db.add(PartyGroupMember(group_id=g.id, kind=m.kind, ref_id=m.ref_id))
    if body.name:
        g.name = body.name[:160]
    db.flush()
    audit_service.record(db, action="party.link", actor_user_id=current.id,
                         entity_type="party_group", entity_id=g.id,
                         after={"members": [f"{m.kind}:{m.ref_id}" for m, _c in cards]})
    db.commit()
    return _group_out(db, g, {b.id: b.name for b in db.scalars(select(Branch))})


@router.delete("/party-groups/{gid}/members/{kind}/{ref_id}", status_code=204)
def unlink(
    gid: int, kind: str, ref_id: int,
    current: CurrentUser = Depends(require_capability(CAP_CUSTOMER_WRITE)),
    db: Session = Depends(get_db),
) -> None:
    g = db.get(PartyGroup, gid)
    if g is None or not _visible(current, g.branch_id):
        raise HTTPException(404, {"code": "not_found", "message": "الطرف غير موجود."})
    db.execute(delete(PartyGroupMember).where(
        PartyGroupMember.group_id == gid, PartyGroupMember.kind == kind,
        PartyGroupMember.ref_id == ref_id))
    left = db.scalars(select(PartyGroupMember).where(PartyGroupMember.group_id == gid)).all()
    if len(left) < 2:
        db.execute(delete(PartyGroupMember).where(PartyGroupMember.group_id == gid))
        db.delete(g)
    audit_service.record(db, action="party.unlink", actor_user_id=current.id,
                         entity_type="party_group", entity_id=gid, after={"removed": f"{kind}:{ref_id}"})
    db.commit()


class NettingIn(BaseModel):
    customer_id: int
    supplier_id: int
    amount: Decimal
    family: str | None = None
    entry_date: date | None = None
    description: str | None = Field(default=None, max_length=255)


@router.post("/party-groups/{gid}/netting", status_code=201)
def netting(
    gid: int, body: NettingIn,
    current: CurrentUser = Depends(require_capability(CAP_VOUCHER_WRITE)),
    db: Session = Depends(get_db),
) -> dict:
    g = db.get(PartyGroup, gid)
    if g is None or not _visible(current, g.branch_id):
        raise HTTPException(404, {"code": "not_found", "message": "الطرف غير موجود."})
    members = {(m.kind, m.ref_id) for m in db.scalars(
        select(PartyGroupMember).where(PartyGroupMember.group_id == gid))}
    if ("customer", body.customer_id) not in members or ("supplier", body.supplier_id) not in members:
        raise HTTPException(422, {"code": "validation",
                                  "message": "يجب أن يكون العميل والمورد من الطرف نفسه."})
    value = to_money(body.amount)
    if value <= 0:
        raise HTTPException(422, {"code": "validation", "message": "يجب أن يكون المبلغ أكبر من صفر."})
    try:
        cacc = customer_merge_service.receivable_account(db, body.customer_id, body.family)
    except customer_merge_service.MergeError as exc:
        raise HTTPException(422, {"code": "validation", "message": str(exc)}) from exc
    sacc = db.scalar(select(SupplierAccount).where(SupplierAccount.supplier_id == body.supplier_id))
    if cacc is None or sacc is None:
        raise HTTPException(422, {"code": "validation", "message": "العميل أو المورد ليس له حساب."})
    owes = ledger_service.balance_of(db, cacc.account_id)
    owe = ledger_service.balance_of(db, sacc.account_id)
    if value > owes or value > owe:
        raise HTTPException(409, {"code": "conflict", "message": (
            f"المقاصة أكبر من الرصيد — عليه بصفته عميلاً {owes} وله بصفته مورداً {owe}، "
            f"والحد الأقصى للمقاصة {min(owes, owe)}.")})
    cust = db.get(Customer, body.customer_id)
    sup = db.get(Supplier, body.supplier_id)
    stmt = f"مقاصة — {g.name}"
    try:
        entry = ledger_service.post_entry(
            db, entry_type="netting", actor_user_id=current.id,
            description=body.description or f"{stmt}: من رصيد المورد «{sup.name}» لرصيد العميل «{cust.name}»",
            entry_date=body.entry_date or date.today(), branch_id=g.branch_id or cust.branch_id,
            lines=[LineInput(sacc.account_id, Direction.debit, value, statement=stmt),
                   LineInput(cacc.account_id, Direction.credit, value, statement=stmt)],
        )
    except LedgerError as exc:
        raise HTTPException(409, {"code": "conflict", "message": str(exc)}) from exc
    audit_service.record(db, action="party.netting", actor_user_id=current.id,
                         entity_type="party_group", entity_id=gid,
                         after={"entry_id": entry.id, "amount": str(value)})
    db.commit()
    return {"entry_id": entry.id, "amount": str(value)}
