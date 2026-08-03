"""كشف الحساب — مندوب و الحساب الرئيسي (031-a5-restructure).

Their كشف حساب names the rep on each row and the main account beside the sub-account. Ours had
neither, and both were one join away rather than missing data: the ledger LINE holds no rep, but
the document that posted it always did, and the account has always known its own parent.

The rep column is the kind of thing that looks finished while doing nothing — every document in
the dev database happens to have no rep, so an empty column there proves only that the column
renders. These create a document that DOES name one.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select


@pytest.fixture()
def sold(client, inv_world, login, db):
    """One sale posted by a named rep, and the revenue account it credited."""
    from src.services import account_resolver

    h = login("admin")
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف كشف المندوب", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    wh = inv_world["central_wh"]
    client.post("/api/v1/stock/permits", headers=h, json={
        "kind": "receipt", "warehouse_id": wh,
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_cost": "60"}]})
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل كشف المندوب", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()

    res = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "100"}],
        "cash_amount": "200", "credit_amount": "0",
        "rep_id": inv_world["rep_a"]})
    assert res.status_code == 201, res.text
    revenue = account_resolver.sales_revenue_account(db)
    return {"h": h, "revenue_id": revenue.id, "invoice": res.json()}


def test_the_statement_names_the_rep_on_the_document(client, sold):
    """The line has no rep. The invoice does, so the row can say who sold it."""
    res = client.get(f"/api/v1/accounts/{sold['revenue_id']}/statement", headers=sold["h"])
    assert res.status_code == 200, res.text
    rows = [ln for ln in res.json()["lines"]
            if ln.get("doc_number") == sold["invoice"]["document_number"]]
    assert rows, "the sale should appear on the revenue account"
    assert rows[0]["rep_name"], "the row must name the rep who sold it"


def test_a_row_with_no_document_names_no_rep(client, sold, db, inv_world):
    """A hand-written journal entry has no document and therefore no rep. Empty is the answer —
    borrowing the rep from a neighbouring row would be worse than saying nothing."""
    import datetime

    from src.models.ledger import Direction
    from src.services import account_resolver, ledger_service
    from src.services.ledger_service import LineInput

    equity = account_resolver.opening_balance_equity_account(db)
    ledger_service.post_entry(
        db, entry_type="journal", actor_user_id=inv_world["admin"],
        entry_date=datetime.date(2026, 1, 2),
        lines=[LineInput(sold["revenue_id"], Direction.credit, 50),
               LineInput(equity.id, Direction.debit, 50)])
    db.commit()

    rows = client.get(f"/api/v1/accounts/{sold['revenue_id']}/statement",
                      headers=sold["h"]).json()["lines"]
    manual = [ln for ln in rows if ln["entry_type"] == "journal"]
    assert manual, "the manual entry should be on the statement"
    assert manual[0]["rep_name"] is None


def test_the_statement_names_the_book_the_account_sits_under(client, sold, db):
    """الحساب الرئيسي beside الحساب الفرعي — «إيراد المبيعات» is not self-locating."""
    from src.models.ledger import Account

    res = client.get(f"/api/v1/accounts/{sold['revenue_id']}/statement", headers=sold["h"]).json()
    account = db.get(Account, sold["revenue_id"])
    if account.parent_id:
        assert res["main_account_id"] == account.parent_id
        assert res["main_account_name"]
    else:
        # A top-level account IS its own book; saying so by leaving it empty beats repeating the
        # account's own name back as its parent.
        assert res["main_account_id"] is None


def test_a_top_level_account_reports_no_parent(client, sold, db):
    from src.models.ledger import Account

    root = db.scalars(select(Account).where(Account.parent_id.is_(None))).first()
    res = client.get(f"/api/v1/accounts/{root.id}/statement", headers=sold["h"])
    assert res.status_code == 200, res.text
    assert res.json()["main_account_id"] is None
