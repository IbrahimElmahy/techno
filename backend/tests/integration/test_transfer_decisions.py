"""إذن التحويل — القرارات اللي عليه (031-a5-restructure).

Asked for: clicking «اعتماد» opens the transfer itself with every decision on it — change a
quantity, remove an item, approve, reject — and **deleting the request is forbidden**.

Two things had to change for that to be expressible at all:

* **A transfer was ONE item.** `item_id` and `quantity` sat on the document, so moving five items
  meant five documents created together with nothing tying them, and «امسح صنف من الإذن» had only
  one possible meaning — delete the document. Which is the thing that must not happen. The item
  moved onto lines.
* **`rejected` was a status nothing ever set.** A request that was not going to happen had two ways
  out: approve it anyway, or leave it pending forever.

Documents written before lines existed keep working off their own item/quantity — pinned below,
because a migration that quietly changes how old stock moved would be far worse than the gap it
closes.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def pending(client, inv_world, login, db):
    """A pending transfer with two lines, and stock behind them."""
    from src.models.transfer import StockTransfer, TransferRoute
    from src.services import stock_permit_service, transfer_service

    h = login("admin")
    src_wh, dst_wh = inv_world["central_wh"], inv_world["branch_wh"]
    items = []
    for name in ("صنف التحويل أ", "صنف التحويل ب"):
        it = client.post("/api/v1/items", headers=h, json={
            "name": name, "kind": "raw_material", "unit_of_measure": "piece",
            "purchase_price": "5"}).json()
        items.append(it["id"])
        stock_permit_service.create_permit(
            db, kind="receipt", warehouse_id=src_wh,
            lines=[{"item_id": it["id"], "quantity": "50", "unit_cost": "5"}],
            reason="رصيد", actor_user_id=inv_world["admin"])
    db.commit()

    from src.models.stock import LocationKind
    t = transfer_service.initiate(
        db, item_id=items[0], quantity=Decimal("5"), route=TransferRoute.central_to_branch,
        source_kind=LocationKind.warehouse, source_id=src_wh,
        dest_kind=LocationKind.warehouse, dest_id=dst_wh,
        initiated_by=inv_world["admin"])
    db.commit()
    a = transfer_service.add_line(db, transfer_id=t.id, item_id=items[0], quantity=Decimal("5"))
    b = transfer_service.add_line(db, transfer_id=t.id, item_id=items[1], quantity=Decimal("3"))
    db.commit()
    return {"h": h, "transfer": t, "lines": [a, b], "items": items,
            "src": src_wh, "dst": dst_wh}


def test_the_document_carries_its_lines(client, pending):
    res = client.get("/api/v1/transfers", headers=pending["h"])
    assert res.status_code == 200, res.text
    doc = next(t for t in res.json() if t["id"] == pending["transfer"].id)
    assert len(doc["lines"]) == 2


def test_a_quantity_can_be_changed_while_it_is_pending(client, pending):
    res = client.patch(f"/api/v1/transfers/lines/{pending['lines'][0].id}",
                       headers=pending["h"], json={"quantity": "9"})
    assert res.status_code == 200, res.text
    line = next(l for l in res.json()["lines"] if l["id"] == pending["lines"][0].id)
    assert Decimal(line["quantity"]) == Decimal("9")


def test_an_item_can_be_removed_from_the_request(client, pending):
    res = client.delete(f"/api/v1/transfers/lines/{pending['lines'][1].id}",
                        headers=pending["h"])
    assert res.status_code == 200, res.text
    assert len(res.json()["lines"]) == 1


def test_there_is_no_way_to_delete_the_request(client, pending):
    """The rule stated outright. Somebody asked for this transfer and somebody may have to answer
    for it; a document that can vanish is a decision with no record."""
    res = client.delete(f"/api/v1/transfers/{pending['transfer'].id}", headers=pending["h"])
    assert res.status_code in (404, 405), res.text


def test_rejecting_moves_no_stock(client, db, pending):
    """The whole point of rejecting rather than approving-then-reversing: nothing left the shelf,
    so nothing has to come back to it."""
    from src.services import stock_service

    before = stock_service.on_hand(db, item_id=pending["items"][0],
                                   location_kind="warehouse", location_id=pending["src"])
    res = client.post(f"/api/v1/transfers/{pending['transfer'].id}/reject",
                      headers=pending["h"], json={"reason": "الكمية مش متاحة"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "rejected"
    assert res.json()["reject_reason"] == "الكمية مش متاحة"

    after = stock_service.on_hand(db, item_id=pending["items"][0],
                                  location_kind="warehouse", location_id=pending["src"])
    assert after == before


def test_a_rejected_request_can_no_longer_be_edited(client, pending):
    client.post(f"/api/v1/transfers/{pending['transfer'].id}/reject",
                headers=pending["h"], json={"reason": "لأ"})
    res = client.patch(f"/api/v1/transfers/lines/{pending['lines'][0].id}",
                       headers=pending["h"], json={"quantity": "1"})
    assert res.status_code == 409, res.text


def test_an_approved_request_can_no_longer_be_edited(client, pending):
    ok = client.post(f"/api/v1/transfers/{pending['transfer'].id}/approve", headers=pending["h"])
    assert ok.status_code == 200, ok.text
    res = client.patch(f"/api/v1/transfers/lines/{pending['lines'][0].id}",
                       headers=pending["h"], json={"quantity": "1"})
    assert res.status_code == 409, res.text


def test_approving_moves_every_line(client, db, pending):
    from src.services import stock_service

    ok = client.post(f"/api/v1/transfers/{pending['transfer'].id}/approve", headers=pending["h"])
    assert ok.status_code == 200, ok.text

    for item_id, qty in zip(pending["items"], (Decimal("5"), Decimal("3"))):
        assert stock_service.on_hand(
            db, item_id=item_id, location_kind="warehouse",
            location_id=pending["dst"]) == qty, "each line has to arrive"


def test_a_zero_quantity_is_refused_rather_than_treated_as_removal(client, pending):
    """A line that moves nothing still says the item was considered, and «امسح السطر» is its own
    decision with its own button."""
    res = client.patch(f"/api/v1/transfers/lines/{pending['lines'][0].id}",
                       headers=pending["h"], json={"quantity": "0"})
    assert res.status_code == 409, res.text
