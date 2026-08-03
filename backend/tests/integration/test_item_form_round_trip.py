"""إنشاء صنف = تعديل بيانات الصنف — 031-a5-restructure.

The create form was rebuilt field-for-field against a5's and lost the fields that are OURS: the
purchase price, the point value, the alternate units, the max stock. An item could be created
without them and — worse — there was no edit form at all, so nothing on the item's own row could
ever be corrected afterwards. A typo in a name was permanent.

Both forms are now one component, so a field can no longer exist on one and not the other. These
check the contract that makes that possible: everything the form sends must be **stored and
returned**, on creation and on edit. A field the screen writes and the API drops is invisible —
the form looks like it worked.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def h(login, world):
    """`world` seeds the users; without it there is nobody to log in as."""
    return login("admin")


def _get(client, h, item_id):
    res = client.get("/api/v1/items", headers=h)
    assert res.status_code == 200, res.text
    return next(i for i in res.json() if i["id"] == item_id)


def test_everything_the_form_sends_comes_back(client, h, inv_world):
    """The whole create payload, read back off the list the screen reloads into."""
    res = client.post("/api/v1/items", headers=h, json={
        "name": "صنف كامل", "kind": "raw_material", "unit_of_measure": "kg",
        "purchase_price": "12.50",
        "default_discount_pct": "7.5",
        "min_stock": "10", "max_stock": "200",
        "is_perishable": True, "is_serialized": False,
        "piece_name": "شيكارة", "pieces_per_unit": "25",
        "category": "خامات", "description": "وصف الصنف",
        "default_warehouse_id": inv_world["central_wh"]})
    assert res.status_code == 201, res.text
    row = _get(client, h, res.json()["id"])

    assert Decimal(row["purchase_price"]) == Decimal("12.50")
    assert Decimal(row["default_discount_pct"]) == Decimal("7.5")
    assert Decimal(row["min_stock"]) == Decimal("10")
    assert Decimal(row["max_stock"]) == Decimal("200")
    assert row["is_perishable"] is True
    assert row["piece_name"] == "شيكارة"
    assert Decimal(row["pieces_per_unit"]) == Decimal("25")
    assert row["description"] == "وصف الصنف"
    assert row["default_warehouse_id"] == inv_world["central_wh"]


def test_every_created_field_can_also_be_edited(client, h, inv_world):
    """The half that did not exist: an item's own row had no editor at all."""
    created = client.post("/api/v1/items", headers=h, json={
        "name": "صنف للتعديل", "kind": "raw_material", "unit_of_measure": "kg",
        "purchase_price": "10", "min_stock": "5"}).json()

    res = client.patch(f"/api/v1/items/{created['id']}", headers=h, json={
        "name": "الاسم بعد التصحيح",
        "purchase_price": "18",
        "default_discount_pct": "12",
        "min_stock": "20", "max_stock": "400",
        "is_perishable": True,
        "piece_name": "برميل", "pieces_per_unit": "4",
        "description": "اتعدّل",
        "default_warehouse_id": inv_world["central_wh"]})
    assert res.status_code == 200, res.text

    row = _get(client, h, created["id"])
    assert row["name"] == "الاسم بعد التصحيح"
    assert Decimal(row["purchase_price"]) == Decimal("18")
    assert Decimal(row["default_discount_pct"]) == Decimal("12")
    assert Decimal(row["max_stock"]) == Decimal("400")
    assert row["is_perishable"] is True
    assert row["piece_name"] == "برميل"
    assert row["description"] == "اتعدّل"


def test_a_products_point_value_is_reachable_the_moment_it_exists(client, h):
    """Points are the field the rebuild dropped. They are set through their own endpoint, so the
    form writes them right after creating the item rather than making somebody come back."""
    item = client.post("/api/v1/items", headers=h, json={
        "name": "منتج بنقاط", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50"}).json()

    res = client.put(f"/api/v1/products/{item['id']}/point-value", headers=h,
                     json={"point_value": 0.167})
    assert res.status_code in (200, 201), res.text
    back = client.get(f"/api/v1/products/{item['id']}/point-value", headers=h).json()
    assert Decimal(str(back["point_value"])) == Decimal("0.167")


def test_alternate_units_are_reachable_the_moment_it_exists(client, h):
    """Same story: an item sold by the carton had to be created, saved, found and reopened before
    it could be told what a carton is."""
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف بالكرتونة", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "5"}).json()

    res = client.put(f"/api/v1/items/{item['id']}/units", headers=h,
                     json={"units": [{"name": "كرتونة", "factor": "12.000"}]})
    assert res.status_code == 200, res.text
    names = [u["name"] for u in res.json()["units"]]
    assert "كرتونة" in names


def test_a_nullable_field_can_be_cleared_not_just_changed(client, h, inv_world):
    """The PATCH used to skip every null, which made nullable fields ONE-WAY: a reorder level, a
    default warehouse or a note could be set and then never removed. «not sent» and «sent empty»
    are different instructions and the API now tells them apart."""
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف المسح", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "min_stock": "5", "description": "ملحوظة",
        "default_warehouse_id": inv_world["central_wh"]}).json()
    assert _get(client, h, item["id"])["description"] == "ملحوظة"

    res = client.patch(f"/api/v1/items/{item['id']}", headers=h, json={
        "min_stock": None, "description": None, "default_warehouse_id": None})
    assert res.status_code == 200, res.text

    row = _get(client, h, item["id"])
    assert row["min_stock"] is None
    assert row["description"] is None
    assert row["default_warehouse_id"] is None


def test_a_field_left_out_is_untouched(client, h):
    """The other half of the same rule: omitting a field must not wipe it."""
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الثبات", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "description": "تفضل زي ما هي"}).json()

    client.patch(f"/api/v1/items/{item['id']}", headers=h, json={"name": "اسم جديد"})
    row = _get(client, h, item["id"])
    assert row["name"] == "اسم جديد"
    assert row["description"] == "تفضل زي ما هي"


def test_an_items_own_discount_is_a_number_not_an_agreement(client, h):
    """An item always HAS a rate — 0 is «no discount», a complete answer. The «nothing agreed»
    case belongs to the customer, whose column is the nullable one."""
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف بلا خصم", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10"}).json()
    assert Decimal(_get(client, h, item["id"])["default_discount_pct"]) == Decimal("0")
