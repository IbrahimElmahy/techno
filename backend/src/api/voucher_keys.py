"""مفاتيح خاصة — ربط بين حسابين رئيسيين، والسند بيتحدد من الاتجاه.

Their system carries this beside «قيد حر», not beside «اوراق قبض ودفع», and that placement is the
whole specification: a free entry asks for both accounts every single time; a key is the same
entry with the accounts already answered.

**The direction decides what it is.** «مدين الخزينة / دائن العملاء» is money coming in from a
customer — that is a سند قبض, and it must be posted as one so it inherits the أبيض/بولي split, the
rep's custody rules and the safe's balance guard. Turn the pair around and it is a refund. Point it
at a supplier and it is a سند صرف. So this module resolves the pair to a voucher kind and the
screen posts through THAT voucher's own endpoint — the key is a faster door onto the existing
document, never a second way of writing it.

A pair that matches nothing known is still legal: it posts as a plain journal entry, which is what
«قيد حر» would have done with the same two accounts typed out by hand.
"""
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
    # Each side is EITHER one account OR a whole group («العملاء» = customer_receivable). Exactly
    # one of the two is given per side.
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
    # What the screen should DO with this key: which voucher to post, and which parties to ask for
    # on the way. Resolved here so the rule lives in one place — a screen deciding for itself would
    # be a second answer that drifts from this one.
    voucher_kind: str
    asks: list[str]


# (debit type, credit type) → the voucher that pair IS, and which side each party question answers.
# Anything not listed posts as a plain journal entry, exactly what «قيد حر» does with the same two
# accounts. The side matters: knowing «customer» answers the CREDIT side is what stops the door
# asking for the customer and then asking again which account under «الذمم المدينة» he is.
_KINDS: dict[tuple[str, str], tuple[str, dict[str, str]]] = {
    # Money in from a customer. Asks who paid, and which safe took it if the key did not say.
    ("treasury", "customer_receivable"): ("receipt", {"credit": "customer"}),
    # Money out to a supplier.
    ("supplier_payable", "treasury"): ("payment", {"debit": "supplier"}),
    # A rep handing his collections in.
    ("treasury", "custody"): ("handover", {"credit": "rep"}),
    # Spending. The expense heading is the debit side, so the door asks which account under it.
    ("purchases_expense", "treasury"): ("expense", {}),
    ("loyalty_expense", "treasury"): ("expense", {}),
    ("user_defined", "treasury"): ("expense", {}),
    # Between two safes.
    ("treasury", "treasury"): ("transfer", {}),
}


def _side_meaning(db: Session, account: Account | None, group: str | None) -> str | None:
    """الناحية دي معناها إيه — مجموعة كاملة ولا حساب بعينه."""
    if group:
        return group
    if account is None:
        return None
    return _meaning(db, account)


def _meaning(db: Session, account: Account) -> str:
    """الحساب الرئيسي معناه إيه — من اللي تحته.

    A heading carries no type of its own in this chart: «الذمم المدينة» is stored `user_defined`
    and only the per-customer accounts underneath it are `customer_receivable`. Reading the heading
    literally therefore made the most obvious key anybody would build — الخزينة مدين، الذمم المدينة
    دائن — resolve to a free journal entry instead of the سند قبض it plainly is, which is precisely
    the direction rule failing silently.

    So a group means what its postable descendants are, when they agree. When they do not agree the
    heading genuinely is ambiguous, and falling back to its own type lands it on «قيد حر» — the
    honest answer rather than a guess.
    """
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
    """أنهي سند الزوج ده بيمثّله — والأبواب اللي لازم تتسأل."""
    debit = db.get(Account, debit_id) if debit_id else None
    credit = db.get(Account, credit_id) if credit_id else None
    dm = _side_meaning(db, debit, debit_group)
    cm = _side_meaning(db, credit, credit_group)
    if dm is None or cm is None:
        return ("journal", [])
    kind, parties = _KINDS.get((dm, cm), ("journal", {}))
    asks = list(parties.values())
    # A side that is not one settled account is a question: «مصروفات تشغيلية» names a heading, so
    # the door has to ask which account under it. Unless a party question already covers that side —
    # picking the customer IS picking his account, and asking for both would be asking twice.
    for side, acc, group in (("debit", debit, debit_group), ("credit", credit, credit_group)):
        if side in parties:
            continue
        if group or (acc is not None and not acc.is_postable):
            asks.append(f"{side}_account")
    return kind, asks


def _side_name(db: Session, account_id: int | None, group: str | None) -> str | None:
    """اسم الناحية زي ما بيتقري على الشاشة."""
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
    """الناحيتين لازم كل واحدة تبقى حاجة واحدة، ومايكونوش نفس الحاجة.

    Both sides empty, or a side carrying an account AND a group, is a key whose meaning nobody can
    read; and a side pointed at itself posts an entry that balances trivially and moves nothing —
    it would go through cleanly and mean nothing, which is worse than being refused.
    """
    for side, account_id, group in (
        ("المدين", body.debit_account_id, body.debit_group),
        ("الدائن", body.credit_account_id, body.credit_group),
    ):
        if bool(account_id) == bool(group):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
                "code": "validation",
                "message": f"اختار للطرف {side} حساب واحد أو مجموعة واحدة "
                           "— مش الاتنين ولا ولا حاجة."})
        if account_id and db.get(Account, account_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                {"code": "not_found", "message": "الحساب مش موجود."})
        if group:
            try:
                AccountType(group)
            except ValueError:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
                    "code": "validation", "message": "المجموعة دي مش معروفة."}) from None

    same_account = (body.debit_account_id is not None
                    and body.debit_account_id == body.credit_account_id)
    same_group = body.debit_group is not None and body.debit_group == body.credit_group
    if same_account or same_group:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {
            "code": "validation",
            "message": "المدين والدائن مايكونوش نفس الحاجة."})


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
    # Reading is open to anybody who may read a voucher: the keys ARE the vouchers people write,
    # and hiding the list from somebody allowed to write one helps nobody.
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
    """أنهي سند الزوج ده هيعمله — قبل ما المفتاح يتحفظ.

    The setup screen has to tell whoever is defining a key what it will post BEFORE they save it,
    and the honest way to show that is to ask the code that will actually do the posting. A second
    copy of `_KINDS` in the screen would agree today and drift the first time a pair is added here.
    """
    kind, asks = _resolve(db, debit_account_id, credit_account_id,
                          debit_group, credit_group)
    return ResolveOut(voucher_kind=kind, asks=asks)


@router.post("", response_model=VoucherKeyOut, status_code=status.HTTP_201_CREATED)
def create_key(
    body: VoucherKeyIn,
    # Setting one up is deciding where money lands for everybody who presses it — that is the
    # chart owner's call, not a preference.
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
                            {"code": "not_found", "message": "المفتاح مش موجود."})
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
    """Deleting a key touches nothing it ever posted — a voucher is its own document and does not
    point back at the shortcut that opened it."""
    key = db.get(VoucherKey, key_id)
    if key is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            {"code": "not_found", "message": "المفتاح مش موجود."})
    db.delete(key)
    db.commit()
    return {"deleted": key_id}


__all__ = ["router", "AccountType"]
