"""كشف الحساب — رصيد قبل/بعد لكل حركة، ولأي حساب في الشجرة (B3).

The customer and supplier statements already ran a closing balance per line. Two things were
missing and both matter when someone disputes a figure: the balance *before* the movement, so a
line can be read on its own without adding up the ones above it, and the ability to pull the same
statement for any account in the chart — a treasury, an expense, a bank — not only the two
party types that happened to have endpoints.
"""
from __future__ import annotations

import datetime

import pytest


@pytest.fixture()
def books(client, world, login, db):
    """A treasury with an opening balance and a customer who owes 500 from the start of the year."""
    from sqlalchemy import select

    from src.models.customer import CustomerAccount
    from src.models.ledger import Direction
    from src.services import account_resolver, customer_service, ledger_service
    from src.services.ledger_service import LineInput

    result = customer_service.create_customer(
        db, name="عميل الكشف", customer_type="trader", rep_id=world["rep_a"],
        territory_id=world["terr_a"], phone=None, actor_user_id=world["admin"])
    customer = result.customer
    treasury = account_resolver.treasury_account(db)
    equity = account_resolver.opening_balance_equity_account(db)

    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        entry_date=datetime.date(2026, 1, 1),
        lines=[LineInput(treasury.id, Direction.debit, 10000),
               LineInput(equity.id, Direction.credit, 10000)])

    cust_acc = db.scalar(select(CustomerAccount).where(
        CustomerAccount.customer_id == customer.id))
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        entry_date=datetime.date(2026, 1, 1),
        lines=[LineInput(cust_acc.account_id, Direction.debit, 500),
               LineInput(equity.id, Direction.credit, 500)])
    db.commit()
    return {"admin": login("admin"), "customer_id": customer.id,
            "customer_account_id": cust_acc.account_id, "treasury_account_id": treasury.id}


def test_each_line_shows_the_balance_before_it(client, books):
    admin = books["admin"]
    client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": books["customer_id"], "amount": "150"})

    s = client.get(f"/api/v1/customers/{books['customer_id']}/statement", headers=admin).json()
    assert [float(ln["balance_before"]) for ln in s["lines"]] == [0.0, 500.0]
    assert [float(ln["balance"]) for ln in s["lines"]] == [500.0, 350.0]


def test_the_first_line_starts_from_the_opening_balance(client, books):
    """Inside a window the first row must open at the carried-forward figure, not at zero."""
    admin = books["admin"]
    client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": books["customer_id"], "amount": "100",
        "voucher_date": "2026-07-20"})

    s = client.get(f"/api/v1/customers/{books['customer_id']}/statement",
                   headers=admin, params={"date_from": "2026-07-20"}).json()
    assert float(s["opening_balance"]) == 500.0
    assert float(s["lines"][0]["balance_before"]) == 500.0
    assert float(s["lines"][0]["balance"]) == 400.0


def test_any_account_in_the_chart_can_be_read(client, books):
    """The treasury is not a customer and not a supplier, and it still has a statement."""
    admin = books["admin"]
    s = client.get(f"/api/v1/accounts/{books['treasury_account_id']}/statement",
                   headers=admin).json()
    assert s["account_id"] == books["treasury_account_id"]
    assert s["account_name"]
    assert float(s["closing_balance"]) == 10000.0
    assert float(s["lines"][0]["balance_before"]) == 0.0


def test_a_receipt_shows_up_on_the_treasury_statement_too(client, books):
    """Double entry means the same money must appear on both sides of the books."""
    admin = books["admin"]
    client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": books["customer_id"], "amount": "250"})

    s = client.get(f"/api/v1/accounts/{books['treasury_account_id']}/statement",
                   headers=admin).json()
    assert float(s["closing_balance"]) == 10250.0
    assert float(s["lines"][-1]["balance_before"]) == 10000.0


def test_an_unknown_account_is_a_clean_404(client, books):
    resp = client.get("/api/v1/accounts/999999/statement", headers=books["admin"])
    assert resp.status_code == 404
