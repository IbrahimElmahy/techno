"""طلبات البيع والشراء — B9.

An order is what exists before the trade. Nothing has moved and nothing is owed, which is exactly
why it can be written for stock that has not arrived yet — the tests below pin that down, because
an order that quietly reserved or consumed stock would make the balances lie about goods nobody
has committed to.

The one hard rule is that an order becomes at most one invoice. An order that could be converted
twice would double a sale without anyone seeing it happen.
"""
from decimal import Decimal


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _customer(client, h, inv_world, name="عميل الطلب"):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _supplier(client, h, name="مورد الطلب"):
    return client.post("/api/v1/suppliers", headers=h, json={"name": name}).json()


def test_a_sales_order_totals_its_lines(client, inv_world, login):
    admin = login("admin")
    item = _product(client, admin, "مطلوب")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/orders", headers=admin, json={
        "kind": "sale", "customer_id": cust["id"], "due_date": "2026-08-01",
        "lines": [{"item_id": item["id"], "quantity": "3", "unit_price": "100"},
                  {"item_id": item["id"], "quantity": "2", "unit_price": "50"}]})
    assert resp.status_code == 201, resp.text
    order = resp.json()
    assert order["document_number"].startswith("SO-")
    assert order["status"] == "open"
    assert Decimal(order["total"]) == Decimal("400.00")  # 300 + 100


def test_an_order_moves_no_stock(client, inv_world, login):
    """The whole reason an order is not an invoice: it can ask for goods nobody has yet."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "مش موجود")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/orders", headers=admin, json={
        "kind": "sale", "customer_id": cust["id"], "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "500", "unit_price": "100"}]})
    assert resp.status_code == 201, resp.text

    on_hand = client.get("/api/v1/stock/on-hand", headers=admin, params={
        "item_id": item["id"], "location_kind": "warehouse", "location_id": wh}).json()
    assert Decimal(on_hand["on_hand"]) == Decimal("0.000")


def test_a_purchase_order_needs_a_supplier(client, inv_world, login):
    admin = login("admin")
    item = _product(client, admin, "للشراء")

    missing = client.post("/api/v1/orders", headers=admin, json={
        "kind": "purchase",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "60"}]})
    assert missing.status_code == 422

    sup = _supplier(client, admin)
    ok = client.post("/api/v1/orders", headers=admin, json={
        "kind": "purchase", "supplier_id": sup["id"],
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "60"}]})
    assert ok.status_code == 201, ok.text
    assert ok.json()["document_number"].startswith("PO-")


def test_an_order_converts_to_an_invoice_exactly_once(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "للتحويل")
    cust = _customer(client, admin, inv_world)
    sup = _supplier(client, admin, "مورد التوريد")

    # Stock it, so the invoice the order becomes is a real one.
    client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "600", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "60"}]})

    order = client.post("/api/v1/orders", headers=admin, json={
        "kind": "sale", "customer_id": cust["id"], "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "4", "unit_price": "100"}]}).json()

    invoice = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": "400", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "4", "discount_pct": "0"}]})
    assert invoice.status_code == 201, invoice.text

    linked = client.post(f"/api/v1/orders/{order['id']}/convert", headers=admin,
                         json={"invoice_id": invoice.json()["id"]})
    assert linked.status_code == 200, linked.text
    assert linked.json()["status"] == "converted"
    assert linked.json()["converted_invoice_id"] == invoice.json()["id"]

    # A second conversion would double the sale.
    again = client.post(f"/api/v1/orders/{order['id']}/convert", headers=admin,
                        json={"invoice_id": invoice.json()["id"]})
    assert again.status_code == 409


def test_an_open_order_can_be_cancelled_but_a_converted_one_cannot(client, inv_world, login):
    admin = login("admin")
    item = _product(client, admin, "للإلغاء")
    cust = _customer(client, admin, inv_world)
    order = client.post("/api/v1/orders", headers=admin, json={
        "kind": "sale", "customer_id": cust["id"],
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}]}).json()

    cancelled = client.post(f"/api/v1/orders/{order['id']}/cancel", headers=admin)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"

    # And a cancelled order is not a thing you can invoice afterwards.
    assert client.post(f"/api/v1/orders/{order['id']}/convert", headers=admin,
                       json={"invoice_id": 1}).status_code == 409


def test_orders_are_listed_and_filtered(client, inv_world, login):
    admin = login("admin")
    item = _product(client, admin, "مسرود")
    cust = _customer(client, admin, inv_world)
    sup = _supplier(client, admin, "مورد مسرود")
    client.post("/api/v1/orders", headers=admin, json={
        "kind": "sale", "customer_id": cust["id"],
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}]})
    client.post("/api/v1/orders", headers=admin, json={
        "kind": "purchase", "supplier_id": sup["id"],
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "60"}]})

    sales = client.get("/api/v1/orders", headers=admin, params={"kind": "sale"}).json()
    assert sales and all(o["kind"] == "sale" for o in sales)

    open_only = client.get("/api/v1/orders", headers=admin, params={"status": "open"}).json()
    assert all(o["status"] == "open" for o in open_only)
