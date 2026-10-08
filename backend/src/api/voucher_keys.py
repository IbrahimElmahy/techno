from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.auth.dependencies import CurrentUser, require_capability
from src.auth.rbac import CAP_LEDGER_POST, CAP_VOUCHER_READ
from src.core.db import get_db
from src.models.ledger import Account, AccountType
from src.models.voucher_key import VoucherKey
from src.services import chart_service

router = APIRouter(tags=["voucher-keys"], prefix="/voucher-keys")


class VoucherKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    debit_account_id: int | None = None
    credit_account_id: int | None = None
    debit_group: str | None = Field(default=None, max_length=40)
    credit_group: str | None = Field(default=None, max_length=40)
    payment_method: str | None = Field(default=None, max_length=32)
    family: str | None = Field(default=None, max_length=40)
    cost_center_id: int | None = None
    description: str | None = Field(default=None, max_length=255)
    sort_order: int = 0
    active: bool = True


class VoucherKeyOut(VoucherKeyIn):
    id: int
    debit_account_name: str | None = None
    credit_account_name: str | None = None
    voucher_kind: str
    asks: list[str]


_KINDS: dict[tuple[str, str], tuple[str, dict[str, str]]] = {
    ("treasury", "customer_receivable"): ("receipt", {"credit": "customer"}),
    ("supplier_payable", "treasury"): ("payment", {"debit": "supplier"}),
    ("treasury", "custody"): ("handover", {"credit": "rep"}),
    ("purchases_expense", "treasury"): ("expense", {}),
    ("loyalty_expense", "treasury"): ("expense", {}),
    ("user_defined", "treasury"): ("expense", {}),
    ("treasury", "treasury"): ("transfer", {}),
}


def _side_meaning(db: Session, account: Account | None, group: str | None) -> str | None:
    if group:
        return group
    if account is None:
        return None
    return _meaning(db, account)


def _meaning(db: Session, account: Account) -> str:
    if account.is_postable:
        return account.account_type.value

    seen: set[str] = set()
    frontier = [account.id]
    while frontier:
        kids = db.scalars(select(Account).where(Account.parent_id.in_(frontier))).all()
        frontier = []
        for kid in kids:
            if kid.is_postable:
                seen.add(kid.account_type.value)
            else:
                frontier.append(kid.id)
    return seen.pop() if len(seen) == 1 else account.account_type.value


def _resolve(db: Session, debit_id: int | None, credit_id: int | None,
             debit_group: str | None = None, credit_group: str | None = None,
             ) -> tuple[str, list[str]]:
    debit = db.get(Account, debit_id) if debit_id else None
    credit = db.get(Account, credit_id) if credit_id else None
    dm = _side_meaning(db, debit, debit_group)
    cm = _side_meaning(db, credit, credit_group)
    if dm is None or cm is None:
        return ("journal", [])
    kind, parties = _KINDS.get((dm, cm), ("journal", {}))
    asks = list(parties.values())
    for side, acc, group in (("debit", debit, debit_group), ("credit", credit, credit_group)):
        if side in parties:
            continue
        if group or (acc is not None and not acc.is_postable):
            asks.append(f"{side}_account")
    return kind, asks


def _side_name(db: Session, account_id: int | None, group: str | None) -> str | None:
    if group:
        try:
            return chart_service.owner_group_label(AccountType(group)) or group
        except ValueError:
            return group
    if not account_id:
        return None
    acc = db.get(Account, account_id)
    if acc is None:
        return None
    return acc.name or chart_service.bulk_owner_names(db, [acc]).get(acc.id) or acc.code


def _validate(db: Session, body: VoucherKeyIn) -> None:
    for side, account_id, group in (
        ("المدين", body.debit_account_id, body.debit_group),
        ("الدائن", body.credit_account_id, body.credit_group),
    ):
        if bool(account_id) == bool(group):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
                "code": "validation",
                "message": f"اختر للطرف {side} حساباً واحداً أو مجموعة واحدة "
                           "— لا كليهما ولا أيّاً منهما."})
        if account_id and db.get(Account, account_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                {"code": "not_found", "message": "الحساب غير موجود."})
        if group:
            try:
                AccountType(group)
            except ValueError:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
                    "code": "validation", "message": "هذه المجموعة غير معروفة."}) from None

    same_account = (body.debit_account_id is not None
                    and body.debit_account_id == body.credit_account_id)
    same_group = body.debit_group is not None and body.debit_group == body.credit_group
    if same_account or same_group:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": "لا يجوز أن يكون المدين والدائن الحساب نفسه."})


def _out(db: Session, k: VoucherKey) -> VoucherKeyOut:
    kind, asks = _resolve(db, k.debit_account_id, k.credit_account_id,
                          k.debit_group, k.credit_group)
    return VoucherKeyOut(
        id=k.id, name=k.name,
        debit_account_id=k.debit_account_id, credit_account_id=k.credit_account_id,
        debit_group=k.debit_group, credit_group=k.credit_group,
        debit_account_name=_side_name(db, k.debit_account_id, k.debit_group),
        credit_account_name=_side_name(db, k.credit_account_id, k.credit_group),
        payment_method=k.payment_method, family=k.family,
        cost_center_id=k.cost_center_id, description=k.description,
        sort_order=k.sort_order, active=k.active,
        voucher_kind=kind, asks=asks,
    )


@router.get("", response_model=list[VoucherKeyOut])
def list_keys(
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> list[VoucherKeyOut]:
    rows = db.scalars(
        select(VoucherKey).order_by(VoucherKey.sort_order, VoucherKey.id)
    ).all()
    return [_out(db, k) for k in rows]


class ResolveOut(BaseModel):
    voucher_kind: str
    asks: list[str]


@router.get("/resolve", response_model=ResolveOut)
def resolve_pair(
    debit_account_id: int | None = None,
    credit_account_id: int | None = None,
    debit_group: str | None = None,
    credit_group: str | None = None,
    _: CurrentUser = Depends(require_capability(CAP_VOUCHER_READ)),
    db: Session = Depends(get_db),
) -> ResolveOut:
    kind, asks = _resolve(db, debit_account_id, credit_account_id,
                          debit_group, credit_group)
    return ResolveOut(voucher_kind=kind, asks=asks)


@router.post("", response_model=VoucherKeyOut, status_code=status.HTTP_201_CREATED)
def create_key(
    body: VoucherKeyIn,
    current: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
    db: Session = Depends(get_db),
) -> VoucherKeyOut:
    _validate(db, body)
    key = VoucherKey(**body.model_dump(), created_by=current.id)
    db.add(key)
    db.commit()
    return _out(db, key)


@router.put("/{key_id}", response_model=VoucherKeyOut)
def update_key(
    key_id: int,
    body: VoucherKeyIn,
    _: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
    db: Session = Depends(get_db),
) -> VoucherKeyOut:
    key = db.get(VoucherKey, key_id)
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المفتاح غير موجود."})
    _validate(db, body)
    for field, value in body.model_dump().items():
        setattr(key, field, value)
    db.commit()
    return _out(db, key)


@router.delete("/{key_id}", response_model=dict)
def delete_key(
    key_id: int,
    _: CurrentUser = Depends(require_capability(CAP_LEDGER_POST)),
    db: Session = Depends(get_db),
) -> dict:
    key = db.get(VoucherKey, key_id)
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المفتاح غير موجود."})
    db.delete(key)
    db.commit()
    return {"deleted": key_id}


__all__ = ["router", "AccountType"]
