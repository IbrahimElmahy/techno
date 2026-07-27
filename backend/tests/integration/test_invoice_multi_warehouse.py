"""One document, several warehouses — 030 (US1).

The warehouse used to live on the document, so an invoice whose items sat in different places had
to be split into several invoices. Now each LINE carries its warehouse. The rules that must not
bend: stock still cannot go negative in ANY single warehouse, the check is on the SUM of the lines
hitting that warehouse (not each line alone), and reversing puts every line back where it came
from — not all into one place.
"""
from decimal import Decimal

import pytest

from src.models.stock import LocationKind
from src.services import stock_service


def _product(client, h, name, price="100"):
    return client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece", "sale_price": price}).json()


def _customer(client, h, inv_world):
    return client.post("/api/v1/customers", headers=h, json={
        "name": "C", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()


def _seed(client, h, item_id, kind, loc, qty):
    return client.post("/api/v1/manufacturing/produce", headers=h, json={
        "item_id": item_id, "location": {"location_kind": kind, "location_id": loc},
        "quantity": qty})


def _on_hand(Session, item_id, loc_id, kind=LocationKind.warehouse):
    s = Session()
    try:
        return stock_service.on_hand(s, item_id=item_id, location_kind=kind, location_id=loc_id)
    finally:
        s.close()


def test_sale_from_two_warehouses_deducts_each(client, inv_world, login, Session):
    """A single invoice may draw each line from its own warehouse."""
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    a = _product(client, admin, "PartA")
    b = _product(client, admin, "PartB")
    _seed(client, admin, a["id"], "warehouse", central, "10")
    _seed(client, admin, b["id"], "warehouse", branch, "10")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": central},
        "variable_discount_pct": "0", "cash_amount": "800", "credit_amount": "0",
        "lines": [
            {"item_id": a["id"], "quantity": "5", "discount_pct": "0",
             "warehouse_id": central},
            {"item_id": b["id"], "quantity": "3", "discount_pct": "0",
             "warehouse_id": branch},
        ]})
    assert resp.status_code == 201, resp.text

    # Each warehouse gave up exactly its own line — one document, one entry.
    assert _on_hand(Session, a["id"], central) == Decimal("5.000")
    assert _on_hand(Session, b["id"], branch) == Decimal("7.000")
    assert _on_hand(Session, b["id"], central) == Decimal("0.000")
    assert resp.json()["ledger_entry_id"] is not None


def test_sum_of_lines_over_available_in_one_warehouse_rejected(client, inv_world, login, Session):
    """Two lines of 3 against a stock of 5 must fail — the check is on the SUM, not per line.

    Checking each line in isolation would let 3 + 3 through and drive the warehouse negative.
    """
    admin = login("admin")
    central = inv_world["central_wh"]
    item = _product(client, admin, "Scarce")
    _seed(client, admin, item["id"], "warehouse", central, "5")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": central},
        "variable_discount_pct": "0", "cash_amount": "600", "credit_amount": "0",
        "lines": [
            {"item_id": item["id"], "quantity": "3", "discount_pct": "0", "warehouse_id": central},
            {"item_id": item["id"], "quantity": "3", "discount_pct": "0", "warehouse_id": central},
        ]})
    assert resp.status_code in (409, 422), resp.text
    # Nothing moved: the document was refused whole.
    assert _on_hand(Session, item["id"], central) == Decimal("5.000")


def test_same_item_across_two_warehouses_is_allowed(client, inv_world, login, Session):
    """The sum rule is per (item × warehouse) — the same item from two warehouses is fine."""
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    item = _product(client, admin, "Split")
    _seed(client, admin, item["id"], "warehouse", central, "3")
    _seed(client, admin, item["id"], "warehouse", branch, "3")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": central},
        "variable_discount_pct": "0", "cash_amount": "600", "credit_amount": "0",
        "lines": [
            {"item_id": item["id"], "quantity": "3", "discount_pct": "0", "warehouse_id": central},
            {"item_id": item["id"], "quantity": "3", "discount_pct": "0", "warehouse_id": branch},
        ]})
    assert resp.status_code == 201, resp.text
    assert _on_hand(Session, item["id"], central) == Decimal("0.000")
    assert _on_hand(Session, item["id"], branch) == Decimal("0.000")


def test_return_sends_each_line_back_to_its_own_warehouse(client, inv_world, login, Session):
    """Returning a multi-warehouse sale must restock each line where it came from."""
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    a = _product(client, admin, "RetA")
    b = _product(client, admin, "RetB")
    _seed(client, admin, a["id"], "warehouse", central, "10")
    _seed(client, admin, b["id"], "warehouse", branch, "10")
    cust = _customer(client, admin, inv_world)

    sale = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": central},
        "variable_discount_pct": "0", "cash_amount": "800", "credit_amount": "0",
        "lines": [
            {"item_id": a["id"], "quantity": "5", "discount_pct": "0", "warehouse_id": central},
            {"item_id": b["id"], "quantity": "3", "discount_pct": "0", "warehouse_id": branch},
        ]})
    assert sale.status_code == 201, sale.text

    ret = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=admin, json={
        "lines": [{"item_id": a["id"], "quantity": "5"},
                  {"item_id": b["id"], "quantity": "3"}]})
    assert ret.status_code == 201, ret.text

    # Back to where each came from — not both into the document's warehouse.
    assert _on_hand(Session, a["id"], central) == Decimal("10.000")
    assert _on_hand(Session, b["id"], branch) == Decimal("10.000")
    assert _on_hand(Session, b["id"], central) == Decimal("0.000")


def test_standalone_return_restocks_each_line_into_its_own_warehouse(
    client, inv_world, login, Session):
    """A standalone return (028) obeys the same per-line rule as a sale."""
    admin = login("admin")
    central, branch = inv_world["central_wh"], inv_world["branch_wh"]
    a = _product(client, admin, "SRetA")
    b = _product(client, admin, "SRetB")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales/returns", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": central},
        "variable_discount_pct": "0", "cash_refund": "0", "credit_reduction": "300",
        "lines": [
            {"item_id": a["id"], "quantity": "2", "unit_price": "100", "warehouse_id": central},
            {"item_id": b["id"], "quantity": "1", "unit_price": "100", "warehouse_id": branch},
        ]})
    assert resp.status_code == 201, resp.text

    assert _on_hand(Session, a["id"], central) == Decimal("2.000")
    assert _on_hand(Session, b["id"], branch) == Decimal("1.000")
    assert _on_hand(Session, b["id"], central) == Decimal("0.000")


def test_line_without_warehouse_falls_back_to_the_document(client, inv_world, login, Session):
    """Omitting the line warehouse keeps the old behaviour: the document's warehouse is used.

    This is what makes pre-030 callers (and the migrated legacy rows) still correct.
    """
    admin = login("admin")
    central = inv_world["central_wh"]
    item = _product(client, admin, "Legacy")
    _seed(client, admin, item["id"], "warehouse", central, "6")
    cust = _customer(client, admin, inv_world)

    resp = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": central},
        "variable_discount_pct": "0", "cash_amount": "400", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "4", "discount_pct": "0"}]})
    assert resp.status_code == 201, resp.text
    assert _on_hand(Session, item["id"], central) == Decimal("2.000")

    detail = client.get(f"/api/v1/sales/{resp.json()['id']}", headers=admin).json()
    # The line records the warehouse it actually used, even though the caller left it out.
    assert detail["lines"][0]["warehouse_id"] == central
