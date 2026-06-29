"""Loyalty integration: earn/reverse (T017), settings (T020), convert (T025), redeem (T031),
return-after-consumption hybrid (T035)."""
from decimal import Decimal


def _product(client, admin, price="100"):
    return client.post("/api/v1/items", headers=admin,
                       json={"name": "Gadget", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": price}).json()


def _set_points(client, asales, item_id, pv):
    client.put(f"/api/v1/products/{item_id}/point-value", headers=asales, json={"point_value": pv})


def _seed_custody(client, admin, item_id, custody_id, qty):
    client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": item_id, "location": {"location_kind": "custody", "location_id": custody_id},
        "quantity": qty})


def _customer(client, admin, inv_world, name="K"):
    return client.post("/api/v1/customers", headers=admin, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _sale(client, rep, inv_world, cust_id, item_id, qty, cash, credit):
    return client.post("/api/v1/sales", headers=rep, json={
        "customer_id": cust_id,
        "origin": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "variable_discount_pct": "0", "cash_amount": cash, "credit_amount": credit,
        "lines": [{"item_id": item_id, "quantity": qty}]})


def _balance(client, admin, cust_id):
    return client.get(f"/api/v1/customers/{cust_id}/points", headers=admin).json()["balance"]


def test_earn_and_reverse_on_sale(client, inv_world, login):
    admin, asales, rep = login("admin"), login("asales"), login("rep_a")
    prod = _product(client, admin)
    _set_points(client, asales, prod["id"], 5)
    _seed_custody(client, admin, prod["id"], inv_world["custody_a"], "5")
    cust = _customer(client, admin, inv_world)
    sale = _sale(client, rep, inv_world, cust["id"], prod["id"], "3", "0", "300")
    assert sale.status_code == 201, sale.text
    assert _balance(client, admin, cust["id"]) == 15  # 3 × 5
    # partial return 1 unit → reverse 5
    client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=rep,
                json={"lines": [{"item_id": prod["id"], "quantity": "1"}]})
    assert _balance(client, admin, cust["id"]) == 10


def test_settings_and_convert_whole_coupons(client, inv_world, login):
    admin, asales = login("admin"), login("asales")
    prod = _product(client, admin)
    _set_points(client, asales, prod["id"], 50)
    _seed_custody(client, admin, prod["id"], inv_world["custody_a"], "5")
    cust = _customer(client, admin, inv_world)
    _sale(client, login("rep_a"), inv_world, cust["id"], prod["id"], "3", "0", "300")  # earn 150
    # non-After-Sales cannot create a coupon type
    assert client.post("/api/v1/loyalty/coupon-types", headers=login("rep_a"),
                       json={"name": "M50", "kind": "money", "point_cost": 50, "value": "50"}).status_code == 403
    ct = client.post("/api/v1/loyalty/coupon-types", headers=asales,
                     json={"name": "M50", "kind": "money", "point_cost": 50, "value": "50"}).json()
    # convert 2 coupons (100 pts); 50 remain
    r = client.post(f"/api/v1/customers/{cust['id']}/points/convert", headers=asales,
                    json={"coupon_type_ids": [ct["id"], ct["id"]]})
    assert r.status_code == 201 and len(r.json()) == 2
    assert _balance(client, admin, cust["id"]) == 50
    # converting 2 more (100) exceeds remaining 50 → 409
    assert client.post(f"/api/v1/customers/{cust['id']}/points/convert", headers=asales,
                       json={"coupon_type_ids": [ct["id"], ct["id"]]}).status_code == 409


def test_redeem_money_and_gift(client, inv_world, login):
    admin, asales, rep = login("admin"), login("asales"), login("rep_a")
    prod = _product(client, admin)
    _set_points(client, asales, prod["id"], 50)
    _seed_custody(client, admin, prod["id"], inv_world["custody_a"], "5")
    cust = _customer(client, admin, inv_world)
    _sale(client, rep, inv_world, cust["id"], prod["id"], "3", "0", "300")  # earn 150
    money_t = client.post("/api/v1/loyalty/coupon-types", headers=asales,
                          json={"name": "M50", "kind": "money", "point_cost": 50, "value": "50"}).json()
    gift_t = client.post("/api/v1/loyalty/coupon-types", headers=asales,
                         json={"name": "G50", "kind": "gift", "point_cost": 50, "value": "50"}).json()
    coupons = client.post(f"/api/v1/customers/{cust['id']}/points/convert", headers=asales,
                          json={"coupon_type_ids": [money_t["id"], gift_t["id"]]}).json()
    money_c, gift_c = coupons[0], coupons[1]

    # money coupon → balanced ledger entry; redeem twice → 409
    r = client.post(f"/api/v1/coupons/{money_c['id']}/redeem", headers=asales, json={"mode": "money"})
    assert r.status_code == 201 and r.json()["ledger_entry_id"] is not None
    assert client.post(f"/api/v1/coupons/{money_c['id']}/redeem", headers=asales,
                       json={"mode": "money"}).status_code == 409

    # gift coupon → product (stock-only). Seed a product to give.
    gift_prod = _product(client, admin, price="50")
    _seed_custody(client, admin, gift_prod["id"], inv_world["custody_a"], "2")
    g = client.post(f"/api/v1/coupons/{gift_c['id']}/redeem", headers=asales, json={
        "mode": "gift_product", "item_id": gift_prod["id"],
        "location_kind": "custody", "location_id": inv_world["custody_a"], "quantity": "1"})
    assert g.status_code == 201 and g.json()["ledger_entry_id"] is None  # stock-only
    assert g.json()["stock_movement_id"] is not None


def _setup_for_return(client, inv_world, login, redeem_first):
    admin, asales, rep = login("admin"), login("asales"), login("rep_a")
    prod = _product(client, admin)
    _set_points(client, asales, prod["id"], 50)
    _seed_custody(client, admin, prod["id"], inv_world["custody_a"], "5")
    cust = _customer(client, admin, inv_world)
    sale = _sale(client, rep, inv_world, cust["id"], prod["id"], "2", "0", "200")  # earn 100
    ct = client.post("/api/v1/loyalty/coupon-types", headers=asales,
                     json={"name": "M50", "kind": "money", "point_cost": 50, "value": "50"}).json()
    coupon = client.post(f"/api/v1/customers/{cust['id']}/points/convert", headers=asales,
                         json={"coupon_type_ids": [ct["id"]]}).json()[0]  # balance now 50, coupon issued
    if redeem_first:
        client.post(f"/api/v1/coupons/{coupon['id']}/redeem", headers=asales, json={"mode": "money"})
    # full return → reverse 100
    client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=rep,
                json={"lines": [{"item_id": prod["id"], "quantity": "2"}]})
    return admin, cust, coupon


def test_return_after_consumption_unredeemed_voids(client, inv_world, login):
    admin, cust, coupon = _setup_for_return(client, inv_world, login, redeem_first=False)
    # unredeemed funded coupon voided; points reclaimed → balance 0
    assert _balance(client, admin, cust["id"]) == 0
    status = client.get("/api/v1/coupons", headers=login("admin"),
                        params={"customer_id": cust["id"]}).json()[0]["status"]
    assert status == "voided"


def test_return_after_consumption_redeemed_negative(client, inv_world, login):
    admin, cust, coupon = _setup_for_return(client, inv_world, login, redeem_first=True)
    # redeemed coupon can't be voided → balance goes negative (owed points)
    assert _balance(client, admin, cust["id"]) == -50
    status = client.get("/api/v1/coupons", headers=login("admin"),
                        params={"customer_id": cust["id"]}).json()[0]["status"]
    assert status == "redeemed"
