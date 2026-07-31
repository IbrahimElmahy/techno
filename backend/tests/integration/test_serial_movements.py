"""حركات سرايل — the trail each serial leaves — 031-a5-restructure.

`item_serial` holds only where a unit is NOW. These pin that the four points a serial changes hands
each write what happened, because it cannot be reconstructed afterwards: stock movements carry
quantities, and a quantity does not name which unit moved.
"""
from __future__ import annotations


def _serialized_item(client, h, name="جهاز مسلسل"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "500", "is_serialized": True}).json()


def _receive(client, h, item_id, wh, serials):
    res = client.post(f"/api/v1/items/{item_id}/serials/receive", headers=h, json={
        "location_kind": "warehouse", "location_id": wh, "serials": serials})
    assert res.status_code == 201, res.text
    return res.json()


def _trail(client, h, serial):
    res = client.get(f"/api/v1/serials/movements?serial={serial}", headers=h)
    assert res.status_code == 200, res.text
    # Newest first from the API; read it forwards, the way a history is read.
    return list(reversed(res.json()))


def test_receiving_writes_the_first_step(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _serialized_item(client, h)
    _receive(client, h, item["id"], wh, ["SN-A1", "SN-A2"])

    trail = _trail(client, h, "SN-A1")
    assert [m["kind"] for m in trail] == ["received"]
    assert trail[0]["location_id"] == wh
    assert trail[0]["item_name"] == "جهاز مسلسل"
    # Each unit gets its own row; two serials on one receipt are two histories, not one.
    assert len(_trail(client, h, "SN-A2")) == 1


def test_the_register_finds_a_unit_by_its_number(client, inv_world, login):
    """The question somebody actually has: a customer holding a unit and a number for it."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _serialized_item(client, h, "جهاز ٢")
    _receive(client, h, item["id"], wh, ["SN-FIND-1"])

    rows = client.get("/api/v1/serials?q=FIND", headers=h).json()
    assert [r["serial"] for r in rows] == ["SN-FIND-1"]
    assert rows[0]["status"] == "in_stock"
    assert rows[0]["location_name"], "a serial in a warehouse must name the warehouse"

    # And across every item — the register exists because /items/{id}/serials could not do this.
    assert client.get("/api/v1/serials", headers=h).json()


def test_sale_and_return_are_both_on_the_trail(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _serialized_item(client, h, "جهاز ٣")
    _receive(client, h, item["id"], wh, ["SN-S1"])

    customer = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل السرايل", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    inv = client.post("/api/v1/sales", headers=h, json={
        "customer_id": customer["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "500", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "serials": ["SN-S1"]}]})
    assert inv.status_code == 201, inv.text
    invoice = inv.json()

    trail = _trail(client, h, "SN-S1")
    assert [m["kind"] for m in trail] == ["received", "sold"]
    sold = trail[-1]
    assert sold["document_type"] == "sales_invoice"
    assert sold["document_id"] == invoice["id"]
    # A sold unit is nowhere. Recording the origin would keep it in that store's list.
    assert sold["location_id"] is None

    ret = client.post(f"/api/v1/sales/{invoice['id']}/returns", headers=h, json={
        "lines": [{"item_id": item["id"], "quantity": "1", "serials": ["SN-S1"]}]})
    assert ret.status_code == 201, ret.text

    trail = _trail(client, h, "SN-S1")
    assert [m["kind"] for m in trail] == ["received", "sold", "returned"]
    assert trail[-1]["location_id"] == wh, "it came back to where it left from"


def test_a_transfer_moves_the_serial_and_says_so(client, inv_world, login):
    h = login("admin")
    src, dest = inv_world["central_wh"], inv_world["branch_wh"]
    item = _serialized_item(client, h, "جهاز ٤")
    _receive(client, h, item["id"], src, ["SN-T1"])

    res = client.post("/api/v1/transfers", headers=h, json={
        "item_id": item["id"], "quantity": "1", "route": "central_to_branch",
        "source": {"location_kind": "warehouse", "location_id": src},
        "dest": {"location_kind": "warehouse", "location_id": dest}})
    assert res.status_code == 201, res.text
    # A pending transfer moves nothing, so the serial has not moved either — the trail only gains
    # its step when the goods actually go.
    assert [m["kind"] for m in _trail(client, h, "SN-T1")] == ["received"]

    ok = client.post(f"/api/v1/transfers/{res.json()['id']}/approve", headers=h)
    assert ok.status_code == 200, ok.text

    trail = _trail(client, h, "SN-T1")
    assert [m["kind"] for m in trail] == ["received", "relocated"]
    assert trail[-1]["location_id"] == dest
    assert trail[-1]["document_type"] == "transfer"


def test_the_trail_is_filterable_the_ways_it_is_read(client, inv_world, login):
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _serialized_item(client, h, "جهاز ٥")
    _receive(client, h, item["id"], wh, ["SN-F1", "SN-F2"])

    by_item = client.get(f"/api/v1/serials/movements?item_id={item['id']}", headers=h).json()
    assert len(by_item) == 2
    by_kind = client.get("/api/v1/serials/movements?kind=received", headers=h).json()
    assert all(m["kind"] == "received" for m in by_kind)
    assert client.get("/api/v1/serials/movements?serial=SN-NOTHING", headers=h).json() == []
