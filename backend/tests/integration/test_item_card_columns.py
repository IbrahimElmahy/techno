"""كارت الصنف — الوحده/القطعه · خصم · ض.م (031-a5-restructure).

Their card carries twenty-six columns. Four more of theirs, all of them one join away rather than
missing data:

* the quantity in the unit the line was TRADED in, beside the pieces the card counts in;
* the line discount, which the line has always carried;
* the line's share of the document VAT.

The unit split is the one worth a test of its own: every line in the dev database happens to be
sold loose, so the split stays empty there and an empty column proves nothing. These sell by the
carton on purpose.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def carton(client, inv_world, login):
    """A product sold by the carton — twelve pieces to a carton — and a stocked warehouse."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الكرتونة", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    # PUT replaces the whole alternate set — that is the endpoint's contract, not a POST per unit.
    unit = client.put(f"/api/v1/items/{item['id']}/units", headers=h, json={
        "units": [{"name": "كرتونة", "factor": "12"}]})
    client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "120", "unit_cost": "6"}]})
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل الكرتونة", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()
    return {"h": h, "wh": wh, "item": item, "customer": cust,
            "unit_ok": unit.status_code in (200, 201)}


def _card(client, h, item_id):
    res = client.get(f"/api/v1/items/{item_id}/card", headers=h)
    assert res.status_code == 200, res.text
    return res.json()["rows"]


def test_the_line_discount_reaches_the_card(client, carton):
    h, item = carton["h"], carton["item"]
    res = client.post("/api/v1/sales", headers=h, json={
        "customer_id": carton["customer"]["id"],
        "origin": {"location_kind": "warehouse", "location_id": carton["wh"]},
        "lines": [{"item_id": item["id"], "quantity": "5", "unit_price": "10",
                   "discount_pct": "10"}],
        "cash_amount": "45", "credit_amount": "0"})
    assert res.status_code == 201, res.text

    sold = [r for r in _card(client, h, item["id"]) if r["movement_type"] == "sale_out"]
    assert sold, "the sale should be on the card"
    assert Decimal(sold[0]["discount_pct"]) == Decimal("10")


def test_a_line_sold_by_the_carton_shows_both_counts(client, carton):
    """The card counts pieces; the line was sold in cartons. «منصرف ٢٤» against a document
    saying «٢ كراتين» is one fact told two ways with nothing connecting them."""
    assert carton["unit_ok"], "the carton unit must exist for this test to mean anything"
    h, item = carton["h"], carton["item"]
    res = client.post("/api/v1/sales", headers=h, json={
        "customer_id": carton["customer"]["id"],
        "origin": {"location_kind": "warehouse", "location_id": carton["wh"]},
        "lines": [{"item_id": item["id"], "quantity": "2", "unit": "كرتونة",
                   "unit_price": "120"}],
        "cash_amount": "240", "credit_amount": "0"})
    assert res.status_code == 201, res.text

    sold = [r for r in _card(client, h, item["id"]) if r["movement_type"] == "sale_out"]
    assert sold
    row = sold[0]
    # Twenty-four pieces left the store; two cartons were sold. Both are true and the card says so.
    assert Decimal(row["quantity_out"]) == Decimal("24")
    assert row["quantity_in_unit"] is not None, (
        "a line traded in a unit other than the piece must show its own count")
    assert Decimal(row["quantity_in_unit"]) == Decimal("2")
    assert row["unit"] == "كرتونة"


def test_a_loose_line_leaves_the_split_empty(client, carton):
    """Repeating «٥ قطعة / ٥» on every loose-sold row is noise, not information."""
    h, item = carton["h"], carton["item"]
    client.post("/api/v1/sales", headers=h, json={
        "customer_id": carton["customer"]["id"],
        "origin": {"location_kind": "warehouse", "location_id": carton["wh"]},
        "lines": [{"item_id": item["id"], "quantity": "3", "unit_price": "10"}],
        "cash_amount": "30", "credit_amount": "0"})

    sold = [r for r in _card(client, h, item["id"]) if r["movement_type"] == "sale_out"]
    assert sold
    assert sold[0]["quantity_in_unit"] is None


def test_a_movement_with_no_document_invents_nothing(client, carton):
    """The opening permit has no sale line behind it, so price, discount and tax stay empty
    rather than being filled with a zero that reads as «agreed, and it is nothing»."""
    h, item = carton["h"], carton["item"]
    rows = [r for r in _card(client, h, item["id"]) if r["movement_type"] != "sale_out"]
    assert rows, "the receiving permit should be on the card"
    assert rows[0]["discount_pct"] is None
    assert rows[0]["tax_amount"] is None
    assert rows[0]["quantity_in_unit"] is None
