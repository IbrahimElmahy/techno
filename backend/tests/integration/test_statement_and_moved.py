"""Two columns their screens have and ours did not — 031-a5-restructure.

Both were data we already held and simply never returned: the cost centre a ledger line was posted
against, and whether an item has ever moved at all.
"""
from __future__ import annotations

from decimal import Decimal


def _product(client, h, name):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": "50"}).json()


def test_a_statement_line_names_its_cost_centre(client, world, login, cost_centers):
    """Their كشف حساب has the column; the journal line always carried the value."""
    h = login("admin")
    cc = cost_centers["cc_nasr"]
    debit, credit = cost_centers["rent"], cost_centers["salaries"]

    posted = client.post("/api/v1/journal-entries", headers=h, json={
        "date": "2026-03-01", "branch_id": world["branch_a"], "description": "قيد بمركز تكلفة",
        "lines": [
            {"account_id": debit, "direction": "debit", "amount": "500",
             "statement": "مصروف المشروع", "cost_center_id": cc},
            {"account_id": credit, "direction": "credit", "amount": "500"},
        ]})
    assert posted.status_code == 201, posted.text

    st = client.get(f"/api/v1/accounts/{debit}/statement", headers=h)
    assert st.status_code == 200, st.text
    line = next(ln for ln in st.json()["lines"] if Decimal(ln["debit"]) == Decimal("500.00"))
    assert line["cost_center_id"] == cc
    assert line["cost_center_name"], "the id alone makes the reader look it up"


def test_a_line_with_no_cost_centre_says_so(client, world, login, chart):
    """Most postings are not against a project, and the column must not invent one."""
    h = login("admin")
    debit, credit = chart["rent"], chart["salaries"]
    client.post("/api/v1/journal-entries", headers=h, json={
        "date": "2026-03-02", "branch_id": world["branch_a"], "description": "قيد بدون مركز",
        "lines": [{"account_id": debit, "direction": "debit", "amount": "70"},
                  {"account_id": credit, "direction": "credit", "amount": "70"}]})

    st = client.get(f"/api/v1/accounts/{debit}/statement", headers=h).json()
    line = next(ln for ln in st["lines"] if Decimal(ln["debit"]) == Decimal("70.00"))
    assert line["cost_center_id"] is None
    assert line["cost_center_name"] is None


def test_moved_is_not_the_same_question_as_in_stock(client, inv_world, login):
    """«له حركة» — an item sold down to zero has moved; one never touched is catalogue noise."""
    h = login("admin")
    wh = inv_world["central_wh"]
    never = _product(client, h, "صنف ما اتحركش")
    emptied = _product(client, h, "صنف اتفضى")
    holding = _product(client, h, "صنف عنده رصيد")

    for item, qty in ((emptied, 5), (holding, 5)):
        assert client.post("/api/v1/manufacturing/produce", headers=h, json={
            "item_id": item["id"], "quantity": str(qty),
            "location": {"location_kind": "warehouse", "location_id": wh}}).status_code == 201

    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل الحركة", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "250", "credit_amount": "0",
        "lines": [{"item_id": emptied["id"], "quantity": "5", "unit_price": "50"}]})

    ids = lambda rows: {r["id"] for r in rows}
    in_stock = ids(client.get("/api/v1/items?stock_filter=in_stock", headers=h).json())
    moved = ids(client.get("/api/v1/items?stock_filter=moved", headers=h).json())

    assert holding["id"] in in_stock and holding["id"] in moved
    # The whole point: emptied is out of stock but has a history worth reading.
    assert emptied["id"] not in in_stock
    assert emptied["id"] in moved
    assert never["id"] not in moved
