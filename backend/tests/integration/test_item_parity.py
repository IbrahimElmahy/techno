"""تعبئة الصنف + خصم وضريبة لكل فئة سعر + سعر اللستة.

Read off their الأصناف screen field by field. Three things it has that we did not:

* **التعبئة** — one selling unit holds N pieces and the piece has its own name («قطعة»، «متر»).
  It describes the goods, so it lives on the item; the multi-unit table is still what a line
  converts by.
* **خصم و ض.م لكل فئة** — a wholesaler and a walk-in do not get the same allowance. One rate on
  the item would make the salesman work out the difference by hand on every line.
* **سعر اللستة** — the published price quoted from. It is not one of the five negotiated tiers,
  and a salesman needs to see it beside whatever tier the customer actually gets so he knows how
  far he has discounted.
"""
from decimal import Decimal


def _product(client, h, **extra):
    body = {"name": "صنف التعبئة", "kind": "product", "unit_of_measure": "carton",
            "sale_price": "100"}
    body.update(extra)
    return client.post("/api/v1/items", headers=h, json=body)


def test_the_packing_is_stored_on_the_item(client, world, login):
    admin = login("admin")
    resp = _product(client, admin, piece_name="قطعة", pieces_per_unit="12",
                    description="كرتونة فيها ١٢ قطعة")
    assert resp.status_code == 201, resp.text
    item = resp.json()
    assert item["piece_name"] == "قطعة"
    assert Decimal(item["pieces_per_unit"]) == Decimal("12.000")
    assert item["description"] == "كرتونة فيها ١٢ قطعة"


def test_the_packing_can_be_edited(client, world, login):
    admin = login("admin")
    item = _product(client, admin).json()
    assert item["piece_name"] is None

    edited = client.patch(f"/api/v1/items/{item['id']}", headers=admin,
                          json={"piece_name": "متر", "pieces_per_unit": "6"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["piece_name"] == "متر"
    assert Decimal(edited.json()["pieces_per_unit"]) == Decimal("6.000")


def test_each_tier_carries_its_own_discount_and_vat(client, world, login):
    admin = login("admin")
    item = _product(client, admin, name="صنف الفئات").json()

    saved = client.put(f"/api/v1/items/{item['id']}/prices", headers=admin, json={
        "tiers": [
            {"tier": "consumer", "price": "100", "discount_pct": "0", "vat_pct": "14"},
            {"tier": "wholesale", "price": "80", "discount_pct": "5", "vat_pct": "14"},
        ]})
    assert saved.status_code == 200, saved.text

    read = client.get(f"/api/v1/items/{item['id']}/prices", headers=admin).json()
    by_tier = {t["tier"]: t for t in read["tiers"]}
    assert Decimal(by_tier["wholesale"]["discount_pct"]) == Decimal("5.00")
    assert Decimal(by_tier["wholesale"]["vat_pct"]) == Decimal("14.00")
    # The walk-in gets no allowance — the two tiers are genuinely independent.
    assert Decimal(by_tier["consumer"]["discount_pct"]) == Decimal("0.00")


def test_the_list_price_is_a_tier_of_its_own(client, world, login):
    """سعر اللستة sits beside the negotiated tiers rather than replacing one."""
    admin = login("admin")
    item = _product(client, admin, name="صنف اللستة").json()

    saved = client.put(f"/api/v1/items/{item['id']}/prices", headers=admin, json={
        "tiers": [
            {"tier": "list_price", "price": "120"},
            {"tier": "consumer", "price": "100"},
        ]})
    assert saved.status_code == 200, saved.text

    read = client.get(f"/api/v1/items/{item['id']}/prices", headers=admin).json()
    by_tier = {t["tier"]: Decimal(t["price"]) for t in read["tiers"]}
    assert by_tier["list_price"] == Decimal("120.00")
    assert by_tier["consumer"] == Decimal("100.00")


def test_prices_without_allowances_still_work(client, world, login):
    """Every existing caller sends price alone; it must keep meaning what it always meant."""
    admin = login("admin")
    item = _product(client, admin, name="صنف بسيط").json()
    saved = client.put(f"/api/v1/items/{item['id']}/prices", headers=admin, json={
        "tiers": [{"tier": "consumer", "price": "55"}]})
    assert saved.status_code == 200, saved.text
    tier = saved.json()["tiers"][0]
    assert Decimal(tier["price"]) == Decimal("55.00")
    assert Decimal(tier["discount_pct"]) == Decimal("0.00")


# ------------------------------------------------------------------- the list columns (مستهلك)
#
# Their list reads `رقم · الفئه · الاسم · باركود · الوحدة · عدد القطع · القطعة · مستهلك`. Seven of
# those eight the list endpoint already carried; مستهلك lives in its own table and the screen must
# not have to ask per row for it.
#
# باركود is deliberately not one of ours: the client asked for barcodes out of the system entirely,
# so this is a divergence from a5 on purpose rather than a column still to be added.


def _row_for(client, h, item_id: int) -> dict:
    rows = client.get("/api/v1/items", headers=h).json()
    return next(r for r in rows if r["id"] == item_id)


def test_a_tier_never_priced_comes_back_empty_not_zero(client, world, login):
    """Absent means «not sold at this tier». Zero would mean «sold for nothing»."""
    admin = login("admin")
    item = _product(client, admin, name="صنف بلا فئات").json()
    client.put(f"/api/v1/items/{item['id']}/prices", headers=admin,
               json={"tiers": [{"tier": "wholesale", "price": "80"}]})

    row = _row_for(client, admin, item["id"])
    assert row["consumer_price"] is None
