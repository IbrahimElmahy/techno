"""Item search/filter + the 360° product file + price history — 027-item-360."""
from __future__ import annotations

from decimal import Decimal


def _item(db, *, code, name, kind="product", sale=None, purchase=None, category=None):
    from src.models.catalog import Item, ItemKind

    it = Item(code=code, name=name, kind=ItemKind(kind), unit_of_measure="قطعة",
              sale_price=Decimal(sale) if sale else None,
              purchase_price=Decimal(purchase) if purchase else None, category=category)
    db.add(it)
    db.flush()
    return it


def _seed(db):
    a = _item(db, code="PR-000001", name="كوع PVC نصف بوصة", sale="7", category="مواسير")
    b = _item(db, code="RM-000001", name="حبيبات PVC", kind="raw_material", purchase="18")
    db.commit()
    return a, b


def test_search_and_kind_filter(client, world, db, login):
    a, b = _seed(db)
    h = login("admin")

    assert [i["id"] for i in client.get("/api/v1/items?q=كوع", headers=h).json()] == [a.id]
    assert [i["id"] for i in client.get("/api/v1/items?q=RM-0000", headers=h).json()] == [b.id]
    assert [i["id"] for i in client.get("/api/v1/items?q=مواسير", headers=h).json()] == [a.id]
    raws = client.get("/api/v1/items?kind=raw_material", headers=h).json()
    assert [i["id"] for i in raws] == [b.id]


def test_list_carries_on_hand_and_filters_by_stock(client, inv_world, db, login):
    from src.models.stock import LocationKind, StockDirection
    from src.services import stock_service

    a, b = _seed(db)
    stock_service.post_movement(
        db, item_id=a.id, location_kind=LocationKind.warehouse,
        location_id=inv_world["central_wh"], movement_type="manufacture_in",
        direction=StockDirection.in_, quantity=Decimal("40"),
        actor_user_id=inv_world["admin"])
    db.commit()

    h = login("admin")
    rows = client.get("/api/v1/items", headers=h).json()
    on_hand = {i["id"]: Decimal(i["on_hand"]) for i in rows}
    assert on_hand[a.id] == Decimal("40.000")
    assert on_hand[b.id] == Decimal("0.000")

    in_stock = client.get("/api/v1/items?stock_filter=in_stock", headers=h).json()
    assert [i["id"] for i in in_stock] == [a.id]
    empty = client.get("/api/v1/items?stock_filter=out_of_stock", headers=h).json()
    assert [i["id"] for i in empty] == [b.id]


def test_profile_reports_stock_sales_and_movements(client, inv_world, db, login):
    from src.models.stock import LocationKind, StockDirection
    from src.services import stock_service

    a, _ = _seed(db)
    stock_service.post_movement(
        db, item_id=a.id, location_kind=LocationKind.warehouse,
        location_id=inv_world["central_wh"], movement_type="manufacture_in",
        direction=StockDirection.in_, quantity=Decimal("25"),
        actor_user_id=inv_world["admin"])
    db.commit()

    body = client.get(f"/api/v1/items/{a.id}/profile", headers=login("admin")).json()
    assert Decimal(body["on_hand"]) == Decimal("25.000")
    assert body["stock_by_location"][0]["quantity"] == "25.000"
    assert len(body["movements"]) == 1
    assert body["movements"][0]["direction"] == "in"
    for section in ("sales", "purchases", "price_history", "tier_prices"):
        assert isinstance(body[section], list)


def test_hard_delete_only_for_an_item_that_never_moved(client, inv_world, db, login):
    from src.models.catalog import Item
    from src.models.stock import LocationKind, StockDirection
    from src.services import stock_service

    a, b = _seed(db)
    h = login("admin")

    # `b` has never appeared anywhere → deleted outright.
    assert client.delete(f"/api/v1/items/{b.id}?hard=true", headers=h).status_code == 204
    db.expunge_all()
    assert db.get(Item, b.id) is None

    # `a` has a stock movement → refused, and the soft delete still deactivates it.
    stock_service.post_movement(
        db, item_id=a.id, location_kind=LocationKind.warehouse,
        location_id=inv_world["central_wh"], movement_type="manufacture_in",
        direction=StockDirection.in_, quantity=Decimal("5"),
        actor_user_id=inv_world["admin"])
    db.commit()
    assert client.delete(f"/api/v1/items/{a.id}?hard=true", headers=h).status_code == 409
    assert client.delete(f"/api/v1/items/{a.id}", headers=h).status_code == 204
    db.expire_all()
    assert db.get(Item, a.id).active is False


def test_price_changes_are_logged_with_old_and_new(client, world, db, login):
    a, _ = _seed(db)
    h = login("admin")

    client.patch(f"/api/v1/items/{a.id}", json={"sale_price": "9.50"}, headers=h)
    client.patch(f"/api/v1/items/{a.id}", json={"sale_price": "11.00"}, headers=h)
    # Re-sending the same price must NOT create a row — only real moves are history.
    client.patch(f"/api/v1/items/{a.id}", json={"sale_price": "11.00"}, headers=h)

    body = client.get(f"/api/v1/items/{a.id}/profile", headers=h).json()
    history = [h_ for h_ in body["price_history"] if h_["field"] == "sale_price"]
    assert len(history) == 2
    newest, older = history[0], history[1]
    assert (older["old_value"], older["new_value"]) == ("7.00", "9.50")
    assert (newest["old_value"], newest["new_value"]) == ("9.50", "11.00")


def test_tier_price_changes_are_logged_too(client, world, db, login):
    a, _ = _seed(db)
    h = login("admin")

    client.put(f"/api/v1/items/{a.id}/prices",
               json={"tiers": [{"tier": "wholesale", "price": "6.00"}]}, headers=h)
    client.put(f"/api/v1/items/{a.id}/prices",
               json={"tiers": [{"tier": "wholesale", "price": "6.50"}]}, headers=h)

    body = client.get(f"/api/v1/items/{a.id}/profile", headers=h).json()
    tier_rows = [r for r in body["price_history"] if r["field"] == "wholesale"]
    assert len(tier_rows) == 2
    assert tier_rows[0]["old_value"] == "6.00" and tier_rows[0]["new_value"] == "6.50"
    assert tier_rows[1]["old_value"] is None  # first time the tier was set
    assert {t["tier"]: t["price"] for t in body["tier_prices"]}["wholesale"] == "6.50"
