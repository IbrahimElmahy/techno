"""أنواع الجرد — كلي · دوري · عينة (031-a5-restructure).

The three differ in exactly one thing: which items land on the sheet. After that they are the same
document — count, difference, post — which is why they share one code path rather than three
near-identical screens that would each drift apart.

* `full` — everything the warehouse holds.
* `cycle` — a batch, oldest-counted first, so the rotation covers the store over time without ever
  closing it. This is the one most businesses actually live on.
* `spot` — exactly the items named, **including ones the books say are gone**, because «هو ده فعلاً
  خلص؟» is a question about precisely those.

The rotation's ordering is the part worth pinning: it reads only POSTED sheets, so a draft somebody
opened and walked away from cannot push an item to the back of the queue.
"""
from __future__ import annotations

import datetime
from decimal import Decimal

import pytest

from src.models.stock_count import StockCountKind


@pytest.fixture()
def stocked(client, inv_world, login, db):
    """Six items on the shelf, one of them believed to be gone."""
    from src.services import stock_permit_service

    h = login("admin")
    wh = inv_world["central_wh"]
    ids = []
    for i in range(6):
        it = client.post("/api/v1/items", headers=h, json={
            "name": f"صنف جرد {i}", "kind": "raw_material", "unit_of_measure": "piece",
            "purchase_price": "5"}).json()
        ids.append(it["id"])
        if i < 5:      # the sixth is deliberately left with no stock
            stock_permit_service.create_permit(
                db, kind="receipt", warehouse_id=wh,
                lines=[{"item_id": it["id"], "quantity": "10", "unit_cost": "5"}],
                reason="رصيد", actor_user_id=inv_world["admin"])
    db.commit()
    return {"h": h, "wh": wh, "items": ids, "empty_item": ids[5]}


def _open(client, s, **body):
    return client.post("/api/v1/stock-counts", headers=s["h"],
                       json={"warehouse_id": s["wh"], **body})


def test_a_full_count_takes_everything_on_the_shelf(client, stocked):
    res = _open(client, stocked, kind="full")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["kind"] == "full"
    assert body["line_count"] == 5, "the five with stock, not the empty one"


def test_a_cycle_count_takes_only_a_batch(client, stocked):
    res = _open(client, stocked, kind="cycle", batch_size=2)
    assert res.status_code == 201, res.text
    assert res.json()["kind"] == "cycle"
    assert res.json()["line_count"] == 2


def test_a_cycle_count_comes_back_to_what_it_has_not_counted(client, db, stocked):
    """The rotation. Count two, post them, and the next batch must be two OTHERS — otherwise it is
    not a rotation, it is the same two items counted forever."""
    from src.services import stock_count_service

    first = _open(client, stocked, kind="cycle", batch_size=2).json()
    detail = client.get(f"/api/v1/stock-counts/{first['id']}", headers=stocked["h"]).json()
    first_items = {ln["item_id"] for ln in detail["lines"]}

    # Post it: counted exactly what the books said, so nothing moves — but the sheet is now history.
    client.put(f"/api/v1/stock-counts/{first['id']}/counts", headers=stocked["h"], json={
        "counts": [{"line_id": ln["id"], "counted_quantity": ln["book_quantity"]}
                   for ln in detail["lines"]]})
    posted = client.post(f"/api/v1/stock-counts/{first['id']}/post", headers=stocked["h"])
    assert posted.status_code == 200, posted.text

    second = _open(client, stocked, kind="cycle", batch_size=2).json()
    detail2 = client.get(f"/api/v1/stock-counts/{second['id']}", headers=stocked["h"]).json()
    second_items = {ln["item_id"] for ln in detail2["lines"]}
    assert not (first_items & second_items), "the rotation must move on"


def test_a_draft_sheet_does_not_advance_the_rotation(client, stocked):
    """A count in progress is not a count that happened. If a draft pushed items to the back,
    opening a sheet and walking away would quietly excuse them from the next round."""
    first = _open(client, stocked, kind="cycle", batch_size=2).json()
    d1 = client.get(f"/api/v1/stock-counts/{first['id']}", headers=stocked["h"]).json()
    items1 = {ln["item_id"] for ln in d1["lines"]}

    second = _open(client, stocked, kind="cycle", batch_size=2).json()   # first still draft
    d2 = client.get(f"/api/v1/stock-counts/{second['id']}", headers=stocked["h"]).json()
    items2 = {ln["item_id"] for ln in d2["lines"]}
    assert items1 == items2, "an unposted sheet must not excuse its items"


def test_a_spot_check_takes_exactly_what_is_named(client, stocked):
    res = _open(client, stocked, kind="spot", item_ids=stocked["items"][:2])
    assert res.status_code == 201, res.text
    assert res.json()["kind"] == "spot"
    assert res.json()["line_count"] == 2


def test_a_spot_check_can_ask_about_an_item_the_books_say_is_gone(client, stocked):
    """The whole point of one. A full or cycle sheet skips an item with no stock; «هو ده فعلاً
    خلص؟» is a question about exactly that item."""
    res = _open(client, stocked, kind="spot", item_ids=[stocked["empty_item"]])
    assert res.status_code == 201, res.text
    assert res.json()["line_count"] == 1


def test_a_spot_check_with_no_items_is_refused(client, stocked):
    """«عينة» of nothing is not a count — and defaulting it to everything would silently open a
    full count under a name that says otherwise."""
    res = _open(client, stocked, kind="spot")
    assert res.status_code == 409, res.text


def test_the_book_quantity_is_frozen_when_the_sheet_opens(client, db, stocked):
    """The classic stocktake error. If the book figure were read at posting, a sale during the
    count would show up as a counting difference — and it is not one."""
    from src.services import stock_permit_service

    sheet = _open(client, stocked, kind="spot", item_ids=[stocked["items"][0]]).json()
    detail = client.get(f"/api/v1/stock-counts/{sheet['id']}", headers=stocked["h"]).json()
    frozen = Decimal(detail["lines"][0]["book_quantity"])

    stock_permit_service.create_permit(
        db, kind="receipt", warehouse_id=stocked["wh"],
        lines=[{"item_id": stocked["items"][0], "quantity": "7", "unit_cost": "5"}],
        reason="وصل أثناء الجرد", actor_user_id=1)
    db.commit()

    again = client.get(f"/api/v1/stock-counts/{sheet['id']}", headers=stocked["h"]).json()
    assert Decimal(again["lines"][0]["book_quantity"]) == frozen


def test_the_kind_defaults_to_full_for_anything_written_before(client, stocked):
    res = _open(client, stocked)          # no kind given
    assert res.status_code == 201, res.text
    assert res.json()["kind"] == StockCountKind.full.value
