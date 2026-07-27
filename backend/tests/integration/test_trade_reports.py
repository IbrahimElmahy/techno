"""The unified trade-report engine — B4.

The client's current system has roughly sixteen sales/purchase reports, but they are the same four
shapes repeated: documents, documents grouped by party, lines, lines grouped by item. Rather than
sixteen endpoints, this is one engine taking (doc_type x level x group_by), plus profit columns
that only make sense on a sale — and only because the cost was frozen onto the line when it sold.
"""
from decimal import Decimal


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _supplier(client, h, name="S"):
    return client.post("/api/v1/suppliers", headers=h, json={"name": name}).json()


def _customer(client, h, inv_world, name="C"):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _buy(client, h, supplier_id, item_id, wh, qty, price):
    return client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier_id,
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": str(Decimal(qty) * Decimal(price)), "credit_amount": "0",
        "lines": [{"item_id": item_id, "quantity": qty, "unit_price": price}]})


def _sell(client, h, cust_id, wh, lines, total):
    return client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust_id,
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "variable_discount_pct": "0", "cash_amount": str(total), "credit_amount": "0",
        "lines": lines})


def _report(client, h, **params):
    resp = client.get("/api/v1/reports/trade", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_documents_level_lists_each_invoice_once(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "DocLevel")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "20", "60")
    cust = _customer(client, admin, inv_world)

    _sell(client, admin, cust["id"], wh,
          [{"item_id": item["id"], "quantity": "2", "discount_pct": "0"}], 200)
    _sell(client, admin, cust["id"], wh,
          [{"item_id": item["id"], "quantity": "3", "discount_pct": "0"}], 300)

    out = _report(client, admin, doc_type="sale", level="document")
    assert len(out["rows"]) == 2
    assert Decimal(out["totals"]["net"]) == Decimal("500.00")


def test_documents_grouped_by_party_merges_a_customers_invoices(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "ByParty")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "30", "60")
    a = _customer(client, admin, inv_world, "زبون أ")
    b = _customer(client, admin, inv_world, "زبون ب")

    _sell(client, admin, a["id"], wh, [{"item_id": item["id"], "quantity": "2", "discount_pct": "0"}], 200)
    _sell(client, admin, a["id"], wh, [{"item_id": item["id"], "quantity": "3", "discount_pct": "0"}], 300)
    _sell(client, admin, b["id"], wh, [{"item_id": item["id"], "quantity": "1", "discount_pct": "0"}], 100)

    out = _report(client, admin, doc_type="sale", level="document", group_by="party")
    by_name = {r["label"]: r for r in out["rows"]}
    assert Decimal(by_name["زبون أ"]["net"]) == Decimal("500.00")
    assert by_name["زبون أ"]["document_count"] == 2
    assert Decimal(by_name["زبون ب"]["net"]) == Decimal("100.00")


def test_lines_grouped_by_item_sums_quantity_across_invoices(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    a = _product(client, admin, "صنف أ")
    b = _product(client, admin, "صنف ب")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], a["id"], wh, "50", "60")
    _buy(client, admin, sup["id"], b["id"], wh, "50", "60")
    cust = _customer(client, admin, inv_world)

    _sell(client, admin, cust["id"], wh, [
        {"item_id": a["id"], "quantity": "2", "discount_pct": "0"},
        {"item_id": b["id"], "quantity": "1", "discount_pct": "0"}], 300)
    _sell(client, admin, cust["id"], wh, [
        {"item_id": a["id"], "quantity": "5", "discount_pct": "0"}], 500)

    out = _report(client, admin, doc_type="sale", level="line", group_by="item")
    by_name = {r["label"]: r for r in out["rows"]}
    assert Decimal(by_name["صنف أ"]["quantity"]) == Decimal("7.000")
    assert Decimal(by_name["صنف ب"]["quantity"]) == Decimal("1.000")


def test_profit_uses_the_cost_frozen_at_sale_time(client, inv_world, login):
    """Bought at 60, sold at 100 → 40 profit per unit, and a later dearer purchase must not move it."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Profitable")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "10", "60")
    cust = _customer(client, admin, inv_world)

    _sell(client, admin, cust["id"], wh,
          [{"item_id": item["id"], "quantity": "4", "discount_pct": "0"}], 400)

    out = _report(client, admin, doc_type="sale", level="line", group_by="item")
    row = out["rows"][0]
    assert Decimal(row["revenue"]) == Decimal("400.00")
    assert Decimal(row["cost"]) == Decimal("240.00")     # 4 x 60
    assert Decimal(row["profit"]) == Decimal("160.00")

    # Buying dearer afterwards must not rewrite the margin already earned.
    _buy(client, admin, sup["id"], item["id"], wh, "10", "90")
    after = _report(client, admin, doc_type="sale", level="line", group_by="item")
    assert Decimal(after["rows"][0]["profit"]) == Decimal("160.00")


def test_margin_by_warehouse_splits_a_multi_warehouse_invoice(client, inv_world, login):
    """One invoice served from two warehouses reports its margin against each warehouse."""
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    a = _product(client, admin, "WhA")
    b = _product(client, admin, "WhB")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], a["id"], central, "10", "60")
    _buy(client, admin, sup["id"], b["id"], branch, "10", "60")
    cust = _customer(client, admin, inv_world)

    _sell(client, admin, cust["id"], central, [
        {"item_id": a["id"], "quantity": "2", "discount_pct": "0", "warehouse_id": central},
        {"item_id": b["id"], "quantity": "3", "discount_pct": "0", "warehouse_id": branch}], 500)

    out = _report(client, admin, doc_type="sale", level="line", group_by="warehouse")
    by_label = {r["label"]: r for r in out["rows"]}
    assert len(by_label) == 2, "each warehouse gets its own margin line"
    assert Decimal(sum(Decimal(r["profit"]) for r in out["rows"])) == Decimal("200.00")


def test_purchases_use_the_same_engine_without_profit(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Bought")
    sup = _supplier(client, admin, "المورد الرئيسي")
    _buy(client, admin, sup["id"], item["id"], wh, "10", "60")
    _buy(client, admin, sup["id"], item["id"], wh, "5", "60")

    docs = _report(client, admin, doc_type="purchase", level="document")
    assert len(docs["rows"]) == 2
    assert Decimal(docs["totals"]["net"]) == Decimal("900.00")

    grouped = _report(client, admin, doc_type="purchase", level="document", group_by="party")
    assert grouped["rows"][0]["label"] == "المورد الرئيسي"
    assert grouped["rows"][0]["document_count"] == 2
    # Profit is meaningless on a purchase — the engine must not invent one.
    assert grouped["rows"][0].get("profit") is None


def test_date_range_narrows_the_report(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Dated")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "10", "60")
    cust = _customer(client, admin, inv_world)
    _sell(client, admin, cust["id"], wh,
          [{"item_id": item["id"], "quantity": "1", "discount_pct": "0"}], 100)

    # A window that ends before anything was sold must come back empty, not unfiltered.
    empty = _report(client, admin, doc_type="sale", level="document",
                    date_from="2020-01-01", date_to="2020-12-31")
    assert empty["rows"] == []
    assert Decimal(empty["totals"]["net"]) == Decimal("0.00")


def test_sale_returns_are_reportable_too(client, inv_world, login):
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = _product(client, admin, "Returnable")
    sup = _supplier(client, admin)
    _buy(client, admin, sup["id"], item["id"], wh, "10", "60")
    cust = _customer(client, admin, inv_world)
    sale = _sell(client, admin, cust["id"], wh,
                 [{"item_id": item["id"], "quantity": "4", "discount_pct": "0"}], 400)
    assert sale.status_code == 201

    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=admin, json={
        "lines": [{"item_id": item["id"], "quantity": "2"}]})
    assert ret.status_code == 201, ret.text

    out = _report(client, admin, doc_type="sale_return", level="line", group_by="item")
    assert Decimal(out["rows"][0]["quantity"]) == Decimal("2.000")
