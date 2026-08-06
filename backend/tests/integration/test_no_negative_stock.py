"""ممنوع الرصيد السالب — من أي باب (031-a5-restructure).

Every writer that takes stock out goes through `stock_service.post_movement`, so the refusal is one
guard at one chokepoint rather than five services each deciding for themselves. These drive stock
below zero from every door that exists and check two things each time: the attempt is refused, and
**the on-hand is exactly what it was**. A guard that raises after writing is not a guard.

The message is asserted too. It replaced «No-negative-stock: on-hand 5 < requested out 8 (item 12,
warehouse 3)» — every fact a developer needs and not one a storekeeper can act on. It now names the
item and the place the way the people using it do, and says how much is missing.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from src.services.stock_service import StockError


@pytest.fixture()
def shelf(client, inv_world, login, db):
    """Ten pieces of one item in the central warehouse, and nothing anywhere else."""
    from src.services import stock_permit_service

    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الرصيد", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    stock_permit_service.create_permit(
        db, kind="receipt", warehouse_id=wh,
        lines=[{"item_id": item["id"], "quantity": "10", "unit_cost": "6"}],
        reason="رصيد", actor_user_id=inv_world["admin"])
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل الرصيد", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()
    db.commit()
    return {"h": h, "wh": wh, "item": item, "customer": cust, "inv": inv_world}


def _on_hand(db, shelf):
    from src.services import stock_service
    return stock_service.on_hand(db, shelf["item"]["id"], "warehouse", shelf["wh"])


def test_the_message_names_the_item_the_place_and_the_shortfall(db, shelf):
    from src.models.stock import LocationKind, StockDirection
    from src.services import stock_service

    with pytest.raises(StockError) as exc:
        stock_service.post_movement(
            db, item_id=shelf["item"]["id"], location_kind=LocationKind.warehouse,
            location_id=shelf["wh"], movement_type="manual_out",
            direction=StockDirection.out, quantity=Decimal("18"),
            actor_user_id=shelf["inv"]["admin"])
    text = str(exc.value)
    assert "صنف الرصيد" in text, "the item has a name; use it"
    assert "الرصيد مايكفيش" in text
    assert "8" in text, "how much is missing is the number somebody acts on"


def test_a_sale_beyond_stock_is_refused_and_moves_nothing(client, db, shelf):
    before = _on_hand(db, shelf)
    res = client.post("/api/v1/sales", headers=shelf["h"], json={
        "customer_id": shelf["customer"]["id"],
        "origin": {"location_kind": "warehouse", "location_id": shelf["wh"]},
        "lines": [{"item_id": shelf["item"]["id"], "quantity": "25", "unit_price": "10"}],
        "cash_amount": "250", "credit_amount": "0"})
    assert res.status_code in (409, 422), res.text
    assert _on_hand(db, shelf) == before


def test_an_issue_permit_beyond_stock_is_refused_and_moves_nothing(client, db, shelf):
    before = _on_hand(db, shelf)
    res = client.post("/api/v1/stock/permits", headers=shelf["h"], json={
        "kind": "issue", "warehouse_id": shelf["wh"], "reason": "صرف زيادة",
        "lines": [{"item_id": shelf["item"]["id"], "quantity": "40"}]})
    assert res.status_code in (409, 422), res.text
    assert _on_hand(db, shelf) == before


def test_approving_a_transfer_beyond_stock_is_refused_and_moves_nothing(client, db, shelf):
    """The dangerous one: the request was raised when there was enough and approved after a sale
    took it. The check at approval is what stands between that and a negative shelf."""
    from src.models.stock import LocationKind
    from src.models.transfer import TransferRoute
    from src.services import transfer_service

    t = transfer_service.initiate(
        db, item_id=shelf["item"]["id"], quantity=Decimal("5"),
        route=TransferRoute.central_to_branch,
        source_kind=LocationKind.warehouse, source_id=shelf["wh"],
        dest_kind=LocationKind.warehouse, dest_id=shelf["inv"]["branch_wh"],
        initiated_by=shelf["inv"]["admin"])
    db.commit()
    transfer_service.add_line(
        db, transfer_id=t.id, item_id=shelf["item"]["id"], quantity=Decimal("50"),
        actor_user_id=shelf["inv"]["admin"])
    db.commit()

    before = _on_hand(db, shelf)
    res = client.post(f"/api/v1/transfers/{t.id}/approve", headers=shelf["h"])
    assert res.status_code in (409, 422), res.text
    assert _on_hand(db, shelf) == before


def test_the_message_can_name_a_custody_too(db, shelf):
    """The other kind of place stock sits in.

    `_label` read `cust.user_id`, which the Custody model has never had — it holds `rep_id` or
    `warehouse_id` depending on `holder_type`. So every refusal on a custody raised AttributeError
    from inside the error message rather than raising the refusal: the storekeeper got a 500 at the
    exact moment the system had something useful to tell them.

    It survived because nothing had ever asked a custody for its label. The warehouse branch was
    covered from the first day and the custody branch by nothing.
    """
    from src.models.stock import LocationKind, StockDirection
    from src.services import stock_service

    with pytest.raises(StockError) as exc:
        stock_service.post_movement(
            db, item_id=shelf["item"]["id"], location_kind=LocationKind.custody,
            location_id=shelf["inv"]["custody_a"], movement_type="manual_out",
            direction=StockDirection.out, quantity=Decimal("1"),
            actor_user_id=shelf["inv"]["admin"])
    text = str(exc.value)
    assert "عهدة" in text, "the place has to be named as a custody, not as a number"
    assert "الرصيد مايكفيش" in text


def test_the_guard_allows_taking_exactly_what_is_there(client, db, shelf):
    """The boundary. Refusing the last piece would be as wrong as allowing one too many."""
    res = client.post("/api/v1/stock/permits", headers=shelf["h"], json={
        "kind": "issue", "warehouse_id": shelf["wh"], "reason": "صرف الكل",
        "lines": [{"item_id": shelf["item"]["id"], "quantity": "10"}]})
    assert res.status_code in (200, 201), res.text
    assert _on_hand(db, shelf) == Decimal("0.000")
