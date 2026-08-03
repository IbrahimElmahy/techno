"""إنشاء الصنف عملية واحدة — 031-a5-restructure.

The form writes an item, its price tiers, its alternate units and its point value. As four separate
HTTP calls that is four chances to end up half-done: the item created, the prices rejected, and the
screen saying «اتسجّل الصنف» because the first call succeeded.

`POST /items` now takes all four and writes them in ONE transaction. These pin the two properties
that makes it safe to build on:

* **nothing survives a rejection** — a bad tier or a bad unit leaves NO item behind;
* **the permission is checked before the write, not after it.** Point values are a different
  capability from the catalogue, and a purchasing manager may create items without being allowed
  to price loyalty. Under the old shape he got a created item, a 403 on the second call, and a
  success message.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def h(login, world):
    return login("admin")


@pytest.fixture()
def buyer(db, world, login):
    """A purchasing manager — `catalog.write` but NOT `product_points.write`.

    Created here rather than in `world` because he exists to prove one boundary, and a fixture
    everybody inherits would make every other test pay for him.
    """
    from src.auth.rbac import RoleName
    from tests.conftest import _user

    _user(db, "pm_points", RoleName.purchasing_manager)
    db.commit()
    return login("pm_points")


def _named(client, h, name):
    rows = client.get("/api/v1/items", headers=h, params={"search": name}).json()
    return [r for r in rows if r["name"] == name]


def test_the_whole_item_is_written_in_one_call(client, h):
    res = client.post("/api/v1/items", headers=h, json={
        "name": "صنف الدفعة الواحدة", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10",
        "tiers": [{"tier": "consumer", "price": "10", "discount_pct": "5", "vat_pct": "14"},
                  {"tier": "wholesale", "price": "8"}],
        "units": [{"name": "كرتونة", "factor": "12"}],
        "point_value": "0.25"})
    assert res.status_code == 201, res.text
    item_id = res.json()["id"]

    tiers = client.get(f"/api/v1/items/{item_id}/prices", headers=h).json()["tiers"]
    assert {t["tier"] for t in tiers} == {"consumer", "wholesale"}

    units = client.get(f"/api/v1/items/{item_id}/units", headers=h).json()["units"]
    assert "كرتونة" in [u["name"] for u in units]

    points = client.get(f"/api/v1/products/{item_id}/point-value", headers=h).json()
    assert Decimal(str(points["point_value"])) == Decimal("0.25")


def test_a_rejected_unit_leaves_no_item_behind(client, h):
    """The item is written first and the units after it. Without one transaction this would leave
    a named item with no units and a 422 on the screen — the worst of both."""
    name = "صنف الوحدة الغلط"
    res = client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "10",
        "units": [{"name": "كرتونة", "factor": "0"}]})     # factor must be > 0
    assert res.status_code == 422, res.text
    assert _named(client, h, name) == [], "a rejected save must not leave a half-made item"


def test_a_rejected_tier_leaves_no_item_behind(client, h):
    name = "صنف السعر الغلط"
    res = client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "10",
        "tiers": [{"tier": "consumer", "price": "-1"}]})
    assert res.status_code == 422, res.text
    assert _named(client, h, name) == []


def test_points_on_a_raw_material_are_refused_and_nothing_is_written(client, h):
    """A raw material has no points to give. Refusing takes the item with it."""
    name = "خامة بنقاط"
    res = client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "raw_material", "unit_of_measure": "kg",
        "purchase_price": "5", "point_value": "1"})
    assert res.status_code == 422, res.text
    assert _named(client, h, name) == []


def test_a_role_without_the_points_capability_is_refused_before_the_write(client, buyer):
    """`purchasing_manager` holds catalog.write but NOT product_points.write. The check happens
    before the commit, so he gets a clean 403 and no orphan item — rather than an item created,
    a 403 on a second call, and «اتسجّل الصنف» on screen."""
    name = "صنف بنقاط بدون صلاحية"
    res = client.post("/api/v1/items", headers=buyer, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": "10", "point_value": "0.5"})
    assert res.status_code == 403, res.text
    assert _named(client, buyer, name) == [], "the refusal must take the item with it"


def test_the_same_role_can_still_create_an_item_without_points(client, buyer):
    """The refusal must be about the points, not about creating items."""
    res = client.post("/api/v1/items", headers=buyer, json={
        "name": "صنف عادي من مدير المشتريات", "kind": "product",
        "unit_of_measure": "piece", "sale_price": "10"})
    assert res.status_code == 201, res.text
