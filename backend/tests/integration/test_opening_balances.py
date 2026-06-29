"""T021: opening balances post as one balanced entry against opening_balance_equity."""
from decimal import Decimal


def test_opening_balances_balanced_against_equity(chart, client, login, db):
    h = login("acct")
    resp = client.post("/api/v1/opening-balances", headers=h, json={
        "date": "2026-01-01",
        "branch_id": chart["branch_a"],
        "lines": [
            {"account_id": chart["treasury"], "amount": "100000.00"},
        ],
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["entry_type"] == "opening_balance"
    # treasury debited 100000, equity credited 100000
    dirs = {(l["account_id"], l["direction"], l["amount"]) for l in body["lines"]}
    assert (chart["treasury"], "debit", "100000.00") in dirs
    assert (chart["opening_equity"], "credit", "100000.00") in dirs

    # treasury balance reflects the opening
    treasury = client.get(f"/api/v1/accounts/{chart['treasury']}", headers=h).json()
    assert treasury["balance"] == "100000.00"


def test_opening_to_non_postable_rejected(chart, client, login):
    h = login("acct")
    resp = client.post("/api/v1/opening-balances", headers=h, json={
        "date": "2026-01-01",
        "branch_id": chart["branch_a"],
        "lines": [{"account_id": chart["expense_group"], "amount": "100.00"}],
    })
    assert resp.status_code == 422


def test_opening_included_in_subsequent_balance(chart, db):
    from datetime import date

    from src.services import chart_service, opening_balance_service
    from src.services.opening_balance_service import OpeningLineInput

    opening_balance_service.post_opening_balances(
        db, entry_date=date(2026, 1, 1), branch_id=chart["branch_a"],
        lines=[OpeningLineInput(chart["treasury"], Decimal("25000.00"))],
        actor_user_id=chart["acct"],
    )
    db.commit()
    assert chart_service.account_balance(db, chart["treasury"]) == Decimal("25000.00")
