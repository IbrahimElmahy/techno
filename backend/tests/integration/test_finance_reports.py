"""Cheques, income statement, balance sheet and aging (020)."""
from __future__ import annotations

from datetime import date, timedelta

import pytest


@pytest.fixture()
def books(client, world, login, db):
    """A funded safe, a customer owing 1,000 (60 days old), a supplier owed 700."""
    from src.models.customer import CustomerAccount
    from src.models.ledger import Account, AccountNature, AccountType, Direction
    from src.models.supplier import Supplier, SupplierAccount
    from src.services import (
        account_resolver,
        customer_service,
        ledger_service,
        treasury_service,
    )
    from src.services.ledger_service import LineInput

    equity = account_resolver.opening_balance_equity_account(db)
    main = treasury_service.default_treasury(db)
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        entry_date=date(2026, 1, 1),
        lines=[LineInput(main.account_id, Direction.debit, 20000),
               LineInput(equity.id, Direction.credit, 20000)])

    result = customer_service.create_customer(
        db, name="عميل التقارير", customer_type="trader", rep_id=world["rep_a"],
        territory_id=world["terr_a"], phone=None, actor_user_id=world["admin"])
    customer = result.customer
    cust_acc = db.scalar(__import__("sqlalchemy").select(CustomerAccount).where(
        CustomerAccount.customer_id == customer.id))
    old = date.today() - timedelta(days=60)
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"], entry_date=old,
        lines=[LineInput(cust_acc.account_id, Direction.debit, 1000),
               LineInput(equity.id, Direction.credit, 1000)])

    supplier = Supplier(code="SUP-8001", name="مورد التقارير")
    db.add(supplier)
    db.flush()
    sup_acc = Account(account_type=AccountType.supplier_payable, owner_ref=supplier.id,
                      normal_side=Direction.credit)
    db.add(sup_acc)
    db.flush()
    db.add(SupplierAccount(supplier_id=supplier.id, account_id=sup_acc.id))
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        entry_date=date.today() - timedelta(days=10),
        lines=[LineInput(equity.id, Direction.debit, 700),
               LineInput(sup_acc.id, Direction.credit, 700)])

    rent = Account(code="5101", name="إيجارات", nature=AccountNature.expense,
                   normal_side=Direction.debit, is_postable=True,
                   account_type=AccountType.user_defined)
    db.add(rent)
    db.commit()
    return {"admin": login("admin"), "rep": login("rep_a"), "customer_id": customer.id,
            "supplier_id": supplier.id, "rent_id": rent.id, "main_id": main.id}


def _cust_balance(client, headers, cid):
    return float(client.get(f"/api/v1/customers/{cid}/account", headers=headers)
                 .json()["balance"])


def test_incoming_cheque_holds_value_until_collected(client, books):
    admin = books["admin"]
    r = client.post("/api/v1/cheques", headers=admin, json={
        "direction": "incoming", "cheque_number": "5501", "amount": "400",
        "due_date": str(date.today() + timedelta(days=15)), "bank_name": "بنك مصر",
        "customer_id": books["customer_id"]})
    assert r.status_code == 201, r.text
    cheque = r.json()
    assert cheque["document_number"] == "CHQI-000001" and cheque["status"] == "pending"
    # The debt drops on receipt, but the treasury has NOT moved yet.
    assert _cust_balance(client, admin, books["customer_id"]) == 600.0
    treasuries = {t["id"]: t for t in client.get("/api/v1/treasuries", headers=admin).json()}
    assert float(treasuries[books["main_id"]]["balance"]) == 20000.0

    s = client.post(f"/api/v1/cheques/{cheque['id']}/settle", headers=admin, json={})
    assert s.status_code == 200 and s.json()["status"] == "settled"
    treasuries = {t["id"]: t for t in client.get("/api/v1/treasuries", headers=admin).json()}
    assert float(treasuries[books["main_id"]]["balance"]) == 20400.0


def test_bounced_cheque_puts_the_debt_back(client, books):
    admin = books["admin"]
    cheque = client.post("/api/v1/cheques", headers=admin, json={
        "direction": "incoming", "cheque_number": "5502", "amount": "250",
        "due_date": str(date.today()), "customer_id": books["customer_id"]}).json()
    assert _cust_balance(client, admin, books["customer_id"]) == 750.0

    b = client.post(f"/api/v1/cheques/{cheque['id']}/bounce", headers=admin)
    assert b.status_code == 200 and b.json()["status"] == "bounced"
    assert _cust_balance(client, admin, books["customer_id"]) == 1000.0
    # A bounced cheque cannot then be collected.
    assert client.post(f"/api/v1/cheques/{cheque['id']}/settle", headers=admin,
                       json={}).status_code == 409


def test_outgoing_cheque_pays_the_supplier_on_settlement(client, books):
    admin = books["admin"]
    c = client.post("/api/v1/cheques", headers=admin, json={
        "direction": "outgoing", "cheque_number": "9001", "amount": "700",
        "due_date": str(date.today()), "supplier_id": books["supplier_id"]})
    assert c.status_code == 201 and c.json()["document_number"] == "CHQO-000001"
    bal = float(client.get(f"/api/v1/suppliers/{books['supplier_id']}/account",
                           headers=admin).json()["balance"])
    assert bal == 0.0  # payable cleared, value now sits in cheques-payable

    s = client.post(f"/api/v1/cheques/{c.json()['id']}/settle", headers=admin, json={})
    assert s.status_code == 200
    treasuries = {t["id"]: t for t in client.get("/api/v1/treasuries", headers=admin).json()}
    assert float(treasuries[books["main_id"]]["balance"]) == 19300.0


def test_unsettle_returns_the_cheque_to_pending(client, books):
    admin = books["admin"]
    c = client.post("/api/v1/cheques", headers=admin, json={
        "direction": "incoming", "cheque_number": "5599", "amount": "300",
        "due_date": str(date.today()), "customer_id": books["customer_id"]}).json()
    client.post(f"/api/v1/cheques/{c['id']}/settle", headers=admin, json={})
    treasuries = {t["id"]: t for t in client.get("/api/v1/treasuries", headers=admin).json()}
    assert float(treasuries[books["main_id"]]["balance"]) == 20300.0

    u = client.post(f"/api/v1/cheques/{c['id']}/unsettle", headers=admin)
    assert u.status_code == 200 and u.json()["status"] == "pending"
    treasuries = {t["id"]: t for t in client.get("/api/v1/treasuries", headers=admin).json()}
    assert float(treasuries[books["main_id"]]["balance"]) == 20000.0  # cash left again
    # It can then be bounced (which a settled cheque could not).
    assert client.post(f"/api/v1/cheques/{c['id']}/bounce", headers=admin).status_code == 200
    # And a pending cheque cannot be unsettled.
    assert client.post(f"/api/v1/cheques/{c['id']}/unsettle", headers=admin).status_code == 409


def test_cancel_only_before_settlement(client, books):
    admin = books["admin"]
    c = client.post("/api/v1/cheques", headers=admin, json={
        "direction": "incoming", "cheque_number": "5503", "amount": "100",
        "due_date": str(date.today()), "customer_id": books["customer_id"]}).json()
    assert client.post(f"/api/v1/cheques/{c['id']}/cancel", headers=admin).status_code == 200
    assert _cust_balance(client, admin, books["customer_id"]) == 1000.0
    assert client.post(f"/api/v1/cheques/{c['id']}/cancel", headers=admin).status_code == 409


def test_cheque_validation_and_rep_lockout(client, books):
    admin, rep = books["admin"], books["rep"]
    past_due = client.post("/api/v1/cheques", headers=admin, json={
        "direction": "incoming", "cheque_number": "1", "amount": "10",
        "issue_date": str(date.today()), "due_date": str(date.today() - timedelta(days=1)),
        "customer_id": books["customer_id"]})
    assert past_due.status_code == 409
    no_party = client.post("/api/v1/cheques", headers=admin, json={
        "direction": "incoming", "cheque_number": "2", "amount": "10",
        "due_date": str(date.today())})
    assert no_party.status_code == 409
    assert client.post("/api/v1/cheques", headers=rep, json={
        "direction": "incoming", "cheque_number": "3", "amount": "10",
        "due_date": str(date.today()), "customer_id": books["customer_id"]}).status_code == 403


def test_income_statement_nets_revenue_against_expenses(client, books):
    admin = books["admin"]
    client.post("/api/v1/vouchers/expenses", headers=admin, json={
        "expense_account_id": books["rent_id"], "amount": "1500"})
    s = client.get("/api/v1/reports/income-statement", headers=admin).json()
    assert float(s["total_expenses"]) == 1500.0
    assert float(s["net_profit"]) == float(s["total_income"]) - 1500.0
    assert any(l["name"] == "إيجارات" for l in s["expenses"])


def test_balance_sheet_balances(client, books):
    admin = books["admin"]
    client.post("/api/v1/vouchers/expenses", headers=admin, json={
        "expense_account_id": books["rent_id"], "amount": "800"})
    b = client.get("/api/v1/reports/balance-sheet", headers=admin).json()
    assert b["balanced"] is True
    assert float(b["total_assets"]) == (
        float(b["total_liabilities"]) + float(b["total_equity"]) + float(b["net_profit"]))


def test_receivables_aging_buckets_by_age(client, books):
    admin = books["admin"]
    rows = client.get("/api/v1/reports/aging?party=customers", headers=admin).json()
    mine = next(r for r in rows if r["party_id"] == books["customer_id"])
    assert float(mine["total"]) == 1000.0
    assert float(mine["buckets"]["31-60"]) == 1000.0  # the debt is 60 days old
    assert float(mine["buckets"]["0-30"]) == 0.0


def test_aging_applies_collections_oldest_first(client, books):
    admin = books["admin"]
    client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": books["customer_id"], "amount": "400"})
    rows = client.get("/api/v1/reports/aging?party=customers", headers=admin).json()
    mine = next(r for r in rows if r["party_id"] == books["customer_id"])
    assert float(mine["total"]) == 600.0
    assert float(mine["buckets"]["31-60"]) == 600.0


def test_payables_aging(client, books):
    rows = client.get("/api/v1/reports/aging?party=suppliers",
                      headers=books["admin"]).json()
    mine = next(r for r in rows if r["party_id"] == books["supplier_id"])
    assert float(mine["total"]) == 700.0
    assert float(mine["buckets"]["0-30"]) == 700.0
