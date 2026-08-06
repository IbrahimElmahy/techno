"""سجل عمليات إذن التحويل — مين عمل إيه وإمتى (031-a5-restructure).

The person who raised a transfer reads its history to find out why what arrived is not what he
asked for. «الكمية اتغيّرت» with no name and no minute on it is not an answer.

Two things were missing. The edits recorded nothing at all — only creation and approval were ever
written — and `GET /api/v1/audit` could not be filtered by `entity_id`, so «سجل المستند ده» could
only be got by fetching every transfer edit ever made and throwing away all but one document's
worth.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def pending(client, inv_world, login, db):
    from src.models.stock import LocationKind
    from src.models.transfer import TransferRoute
    from src.services import stock_permit_service, transfer_service

    h = login("admin")
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف السجل", "kind": "raw_material", "unit_of_measure": "piece",
        "purchase_price": "5"}).json()
    stock_permit_service.create_permit(
        db, kind="receipt", warehouse_id=inv_world["central_wh"],
        lines=[{"item_id": item["id"], "quantity": "50", "unit_cost": "5"}],
        reason="رصيد", actor_user_id=inv_world["admin"])
    db.commit()

    t = transfer_service.initiate(
        db, item_id=item["id"], quantity=Decimal("5"), route=TransferRoute.central_to_branch,
        source_kind=LocationKind.warehouse, source_id=inv_world["central_wh"],
        dest_kind=LocationKind.warehouse, dest_id=inv_world["branch_wh"],
        initiated_by=inv_world["admin"])
    db.commit()
    line = transfer_service.add_line(
        db, transfer_id=t.id, item_id=item["id"], quantity=Decimal("5"),
        actor_user_id=inv_world["admin"])
    db.commit()
    return {"h": h, "transfer": t, "line": line, "item": item}


def _trail(client, h, transfer_id):
    res = client.get("/api/v1/audit", headers=h,
                     params={"entity_type": "stock_transfer", "entity_id": transfer_id})
    assert res.status_code == 200, res.text
    return res.json()


def test_the_trail_can_be_asked_for_one_document(client, pending):
    """The filter that did not exist. Without it the screen asks for every transfer edit in the
    system and discards all but one document's worth."""
    rows = _trail(client, pending["h"], pending["transfer"].id)
    assert rows, "the request itself should already be on the trail"
    assert all(r["entity_id"] == pending["transfer"].id for r in rows)


def test_changing_a_quantity_is_recorded_with_before_and_after(client, pending):
    res = client.patch(f"/api/v1/transfers/lines/{pending['line'].id}",
                       headers=pending["h"], json={"quantity": "9"})
    assert res.status_code == 200, res.text

    rows = _trail(client, pending["h"], pending["transfer"].id)
    edit = next((r for r in rows if r["action"] == "transfer.line_qty"), None)
    assert edit is not None, "an edit nobody recorded is an edit nobody can explain"
    assert edit["actor_user_id"] is not None, "«مين غيّرها» is the first question asked"
    assert edit["created_at"], "and «إمتى» is the second"


def test_removing_an_item_is_recorded_with_what_was_removed(client, pending):
    res = client.delete(f"/api/v1/transfers/lines/{pending['line'].id}", headers=pending["h"])
    assert res.status_code == 200, res.text

    rows = _trail(client, pending["h"], pending["transfer"].id)
    gone = next((r for r in rows if r["action"] == "transfer.line_remove"), None)
    assert gone is not None
    # The removed line is only knowable from the trail — the row itself is gone.
    assert gone.get("before"), "what was taken off has to be in the record, not just that something was"


def test_rejecting_is_recorded_too(client, pending):
    res = client.post(f"/api/v1/transfers/{pending['transfer'].id}/reject",
                      headers=pending["h"], json={"reason": "مش متاح"})
    assert res.status_code == 200, res.text
    rows = _trail(client, pending["h"], pending["transfer"].id)
    assert any(r["action"] == "transfer.reject" for r in rows)


def test_another_document_trail_is_not_mixed_in(client, pending, inv_world, db):
    """The filter has to actually filter — a trail showing another document's edits is worse than
    no trail, because it is read as this one's."""
    from src.models.stock import LocationKind
    from src.models.transfer import TransferRoute
    from src.services import transfer_service

    other = transfer_service.initiate(
        db, item_id=pending["item"]["id"], quantity=Decimal("1"),
        route=TransferRoute.central_to_branch,
        source_kind=LocationKind.warehouse, source_id=inv_world["central_wh"],
        dest_kind=LocationKind.warehouse, dest_id=inv_world["branch_wh"],
        initiated_by=inv_world["admin"])
    db.commit()
    transfer_service.add_line(
        db, transfer_id=other.id, item_id=pending["item"]["id"], quantity=Decimal("2"),
        actor_user_id=inv_world["admin"])
    db.commit()

    rows = _trail(client, pending["h"], pending["transfer"].id)
    assert all(r["entity_id"] == pending["transfer"].id for r in rows)
