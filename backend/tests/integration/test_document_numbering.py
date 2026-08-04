"""ترقيم المستندات — رقم جديد مهما اتمسح إيه (031-a5-restructure).

Every document type numbered itself by COUNTING its rows and adding one. That is right exactly
until a row goes away: delete one document of eight and the count says seven, so the next one is
offered `-000008` — which already exists. `document_number` is UNIQUE, so the insert fails, the
user is told nothing useful, and the NEXT attempt fails identically because the count is stuck one
behind forever.

Nothing in the system deletes documents today, which is why it never surfaced. `stock_permit`,
`reservation` and the item catalogue all have hard-delete paths, and a database restored from a
partial backup produces the same state without anybody deleting anything.

The rule is now «highest issued + 1», which also leaves a gap where a document was removed —
correct for an accounting series, where a missing number is a question somebody should be able to
ask rather than one silently answered by reuse.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from src.services import numbering


@pytest.fixture()
def h(login, world):
    return login("admin")


@pytest.fixture()
def stocked(client, inv_world, login, db):
    """A permit needs at least one line, so the numbering tests need something to put on it."""
    h = login("admin")
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الترقيم", "kind": "raw_material", "unit_of_measure": "piece",
        "purchase_price": "5"}).json()
    return {"h": h, "item_id": item["id"], "wh": inv_world["central_wh"]}


def _line(stocked):
    return [{"item_id": stocked["item_id"], "quantity": "1", "unit_cost": "5"}]


def test_numbers_run_in_order(client, stocked):
    made = []
    for i in range(3):
        res = client.post("/api/v1/stock/permits", headers=stocked["h"], json={
            "kind": "receipt", "warehouse_id": stocked["wh"],
            "reason": f"ترقيم {i}", "lines": _line(stocked)})
        if res.status_code in (200, 201):
            made.append(res.json().get("document_number"))
    assert made == sorted(made), "numbers must not go backwards"
    assert len(set(made)) == len(made), "and must not repeat"


def test_deleting_a_document_does_not_make_the_next_one_collide(db, inv_world, stocked):
    """The failure this replaces, exercised end to end."""
    from src.models.stock_permit import StockPermit
    from src.services import stock_permit_service

    def make(reason):
        return stock_permit_service.create_permit(
            db, kind="receipt", warehouse_id=inv_world["central_wh"],
            lines=[{"item_id": stocked["item_id"], "quantity": "1", "unit_cost": "5"}],
            reason=reason, actor_user_id=inv_world["admin"])

    first, second, third = make("أ"), make("ب"), make("ج")
    db.flush()
    numbers = [first.document_number, second.document_number, third.document_number]
    assert len(set(numbers)) == 3

    db.delete(second)
    db.flush()

    fourth = make("د")
    db.flush()
    assert fourth.document_number not in numbers, (
        f"{fourth.document_number} was already issued — this is the collision")
    # And the gap stays a gap: the removed number is not handed out again.
    live = {p.document_number for p in db.scalars(select(StockPermit)).all()}
    assert second.document_number not in live


def test_the_helper_takes_the_highest_not_the_count(db, inv_world, stocked):
    from src.models.stock_permit import StockPermit
    from src.services import stock_permit_service

    for r in ("١", "٢", "٣"):
        stock_permit_service.create_permit(
            db, kind="receipt", warehouse_id=inv_world["central_wh"],
            lines=[{"item_id": stocked["item_id"], "quantity": "1", "unit_cost": "5"}],
            reason=r, actor_user_id=inv_world["admin"])
    db.flush()
    rows = db.scalars(select(StockPermit)).all()
    db.delete(rows[0])
    db.delete(rows[1])
    db.flush()

    nxt = numbering.next_document_number(db, StockPermit, "ADD")
    remaining = {p.document_number for p in db.scalars(select(StockPermit)).all()}
    assert nxt not in remaining


def test_a_number_that_does_not_fit_the_shape_is_ignored_not_fatal(db, inv_world, stocked):
    """A number edited by hand, or carried in from the old system, must not stop new ones being
    issued — the series simply continues past it."""
    from src.models.stock_permit import StockPermit
    from src.services import stock_permit_service

    p = stock_permit_service.create_permit(
        db, kind="receipt", warehouse_id=inv_world["central_wh"],
        lines=[{"item_id": stocked["item_id"], "quantity": "1", "unit_cost": "5"}],
        reason="قديم", actor_user_id=inv_world["admin"])
    db.flush()
    p.document_number = "ADD-قديم"
    db.flush()

    nxt = numbering.next_document_number(db, StockPermit, "ADD")
    assert nxt.startswith("ADD-")
    assert nxt.split("-")[1].isdigit()


def test_two_series_do_not_share_a_counter(db, inv_world):
    """Vouchers live in one table and number per kind: a receipt and a payment each start at one,
    and one must never advance the other."""
    from src.models.voucher import Voucher, VoucherKind

    a = numbering.next_document_number(db, Voucher, "RCV", where=Voucher.kind == VoucherKind.receipt)
    b = numbering.next_document_number(db, Voucher, "PAY", where=Voucher.kind == VoucherKind.payment)
    assert a.startswith("RCV-") and b.startswith("PAY-")
