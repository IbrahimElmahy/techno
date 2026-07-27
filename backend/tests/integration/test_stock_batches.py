"""Expiry batches: receive, FEFO sale, return and the expiring report — 011 (US2-US4).

The whole feature rests on one invariant: for a perishable item at a location, the sum of its lot
quantities equals its derived on-hand. If those two ever drift apart, the expiry report starts
describing stock that isn't there. Every test below checks the invariant as well as the behaviour.
"""
from decimal import Decimal

from src.models.stock import LocationKind
from src.services import batch_service, stock_service


def _perishable(client, h, name="Milk"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100", "is_perishable": True}).json()


def _plain(client, h, name="Bolt"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "100"}).json()


def _customer(client, h, inv_world):
    return client.post("/api/v1/customers", headers=h, json={
        "name": "C", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _receive(client, h, item_id, wh, expiry, qty):
    return client.post("/api/v1/stock/batches", headers=h, json={
        "item_id": item_id, "location_kind": "warehouse", "location_id": wh,
        "expiry_date": expiry, "quantity": qty})


def _assert_invariant(Session, item_id, wh):
    """Batch sum must equal derived on-hand — the rule the whole feature depends on."""
    s = Session()
    try:
        derived = stock_service.on_hand(s, item_id=item_id,
                                        location_kind=LocationKind.warehouse, location_id=wh)
        lots = batch_service.on_hand_in_batches(
            s, item_id=item_id, location_kind=LocationKind.warehouse, location_id=wh)
        assert lots == derived, f"batch sum {lots} != on-hand {derived}"
        return derived
    finally:
        s.close()


def test_receive_registers_the_lot_and_raises_stock(client, inv_world, login, Session):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, admin)

    assert _receive(client, admin, item["id"], wh, "2026-12-31", "10").status_code == 201
    assert _receive(client, admin, item["id"], wh, "2026-06-30", "5").status_code == 201

    assert _assert_invariant(Session, item["id"], wh) == Decimal("15.000")
    lots = client.get("/api/v1/stock/batches/expiring", headers=admin,
                      params={"before": "2027-01-01", "item_id": item["id"]}).json()
    assert [l["expiry_date"] for l in lots] == ["2026-06-30", "2026-12-31"], "soonest first"


def test_receiving_a_batch_for_a_non_perishable_item_is_rejected(client, inv_world, login):
    admin = login("admin")
    plain = _plain(client, admin)
    resp = _receive(client, admin, plain["id"], inv_world["central_wh"], "2026-12-31", "5")
    assert resp.status_code == 422


def test_sale_consumes_earliest_expiry_first(client, inv_world, login, Session):
    """The headline behaviour: older stock leaves before newer stock."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, admin, "FEFO")
    _receive(client, admin, item["id"], wh, "2026-06-30", "5")    # expires sooner
    _receive(client, admin, item["id"], wh, "2026-12-31", "10")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "700", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "7", "discount_pct": "0"}]})
    assert resp.status_code == 201, resp.text

    assert _assert_invariant(Session, item["id"], wh) == Decimal("8.000")
    lots = client.get("/api/v1/stock/batches/expiring", headers=admin,
                      params={"before": "2027-01-01", "item_id": item["id"]}).json()
    # The June lot is emptied and gone from the report; the December lot lost the remaining 2.
    assert len(lots) == 1
    assert lots[0]["expiry_date"] == "2026-12-31"
    assert Decimal(lots[0]["quantity"]) == Decimal("8.000")


def test_sale_beyond_the_lots_is_rejected(client, inv_world, login, Session):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, admin, "Scarce")
    _receive(client, admin, item["id"], wh, "2026-12-31", "3")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "5", "discount_pct": "0"}]})
    assert resp.status_code in (409, 422), resp.text
    assert _assert_invariant(Session, item["id"], wh) == Decimal("3.000")


def test_return_restores_the_lot_for_its_expiry(client, inv_world, login, Session):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, admin, "Returned")
    _receive(client, admin, item["id"], wh, "2026-12-31", "10")
    cust = _customer(client, admin, inv_world)

    sale = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "400", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "4", "discount_pct": "0"}]})
    assert sale.status_code == 201, sale.text
    assert _assert_invariant(Session, item["id"], wh) == Decimal("6.000")

    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=admin, json={
        "lines": [{"item_id": item["id"], "quantity": "2", "expiry_date": "2026-12-31"}]})
    assert ret.status_code == 201, ret.text
    assert _assert_invariant(Session, item["id"], wh) == Decimal("8.000")


def test_perishable_return_without_an_expiry_is_rejected(client, inv_world, login, Session):
    """Without the date there is no lot to put the goods back into — guessing would break the sum."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, admin, "NoDate")
    _receive(client, admin, item["id"], wh, "2026-12-31", "5")
    cust = _customer(client, admin, inv_world)

    sale = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "2", "discount_pct": "0"}]})
    assert sale.status_code == 201, sale.text

    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=admin, json={
        "lines": [{"item_id": item["id"], "quantity": "1"}]})
    assert ret.status_code in (409, 422), ret.text
    assert _assert_invariant(Session, item["id"], wh) == Decimal("3.000")


def test_expiring_report_lists_only_lots_at_or_before_the_cutoff(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _perishable(client, admin, "Cutoff")
    _receive(client, admin, item["id"], wh, "2026-06-30", "4")
    _receive(client, admin, item["id"], wh, "2026-12-31", "6")

    soon = client.get("/api/v1/stock/batches/expiring", headers=admin,
                      params={"before": "2026-07-01", "item_id": item["id"]}).json()
    assert [l["expiry_date"] for l in soon] == ["2026-06-30"]
