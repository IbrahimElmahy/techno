"""نطاق الكوبونات على فاتورة البيع.

Coupons come off a printed book, so what the counter issues is a range — "from 1200 to 1249" —
not a list of individual codes. Storing that range on the invoice is what later lets a coupon
handed back be traced to a sale that actually happened, which is the check the mobile app needs
when it receives them from the customer. Without it, a serial presented at the door is just a
number nobody can confirm was ever issued.
"""
from decimal import Decimal


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _stocked(client, h, wh, name):
    item = _product(client, h, name)
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": f"مورد {name}"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "600", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "60"}]})
    return item


def _customer(client, h, inv_world, name="عميل الكوبونات"):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _sell(client, h, cust_id, wh, item_id, **extra):
    return client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust_id,
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": "1", "discount_pct": "0"}],
        **extra})


def test_the_range_is_stored_with_the_invoice(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _stocked(client, admin, wh, "بكوبونات")
    cust = _customer(client, admin, inv_world)

    resp = _sell(client, admin, cust["id"], wh, item["id"],
                 coupon_serial_from="1200", coupon_serial_to="1249")
    assert resp.status_code == 201, resp.text
    invoice = resp.json()
    assert invoice["coupon_serial_from"] == "1200"
    assert invoice["coupon_serial_to"] == "1249"

    # And it is still there when the invoice is read back — the app reads it, not the screen.
    again = client.get(f"/api/v1/sales/{invoice['id']}", headers=admin)
    assert again.status_code == 200, again.text


def test_the_count_is_derived_from_a_numeric_range(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _stocked(client, admin, wh, "عد تلقائي")
    cust = _customer(client, admin, inv_world)

    invoice = _sell(client, admin, cust["id"], wh, item["id"],
                    coupon_serial_from="1200", coupon_serial_to="1249").json()
    assert invoice["coupon_count"] == 50  # inclusive of both ends


def test_a_typed_count_wins_over_the_derived_one(client, inv_world, login):
    """The person at the counter can see the book; the arithmetic cannot."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _stocked(client, admin, wh, "عد يدوي")
    cust = _customer(client, admin, inv_world)

    invoice = _sell(client, admin, cust["id"], wh, item["id"],
                    coupon_serial_from="1", coupon_serial_to="10", coupon_count=8).json()
    assert invoice["coupon_count"] == 8


def test_a_lettered_range_is_kept_but_not_counted(client, inv_world, login):
    """Subtracting serials that are not numbers would invent a count nobody can check."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _stocked(client, admin, wh, "بحروف")
    cust = _customer(client, admin, inv_world)

    invoice = _sell(client, admin, cust["id"], wh, item["id"],
                    coupon_serial_from="A-100", coupon_serial_to="A-140").json()
    assert invoice["coupon_serial_from"] == "A-100"
    assert invoice["coupon_count"] is None


def test_an_invoice_without_coupons_is_unchanged(client, inv_world, login):
    """The field is optional, and a sale that issues none must behave exactly as it always did."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _stocked(client, admin, wh, "بدون كوبونات")
    cust = _customer(client, admin, inv_world)

    invoice = _sell(client, admin, cust["id"], wh, item["id"]).json()
    assert invoice["coupon_serial_from"] is None
    assert invoice["coupon_count"] is None
    assert Decimal(invoice["net"]) == Decimal("100.00")
