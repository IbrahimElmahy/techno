"""Cash vouchers + statements (018) — the money cycle that closes receivables/payables."""
from __future__ import annotations

import pytest


@pytest.fixture()
def party(client, world, login, db):
    """A customer with a receivable, a supplier with a payable, and a rep custody account."""
    from src.models.customer import CustomerAccount
    from src.models.ledger import Account, AccountType, Direction
    from src.models.warehouse import Custody
    from src.services import account_resolver, customer_service, ledger_service
    from src.services.ledger_service import LineInput

    result = customer_service.create_customer(
        db, name="عميل التحصيل", customer_type="trader", rep_id=world["rep_a"],
        territory_id=world["terr_a"], phone=None, actor_user_id=world["admin"])
    customer = result.customer

    from src.models.supplier import Supplier, SupplierAccount
    supplier = Supplier(code="SUP-9001", name="مورد الصرف")
    db.add(supplier)
    db.flush()
    sup_acc = Account(account_type=AccountType.supplier_payable, owner_ref=supplier.id,
                      normal_side=Direction.credit)
    db.add(sup_acc)
    db.flush()
    db.add(SupplierAccount(supplier_id=supplier.id, account_id=sup_acc.id))

    custody = db.scalar(
        __import__("sqlalchemy").select(Custody).where(Custody.rep_id == world["rep_a"]))
    if custody is None:
        from src.models.warehouse import HolderType
        cash_acc = Account(account_type=AccountType.custody, owner_ref=None,
                           normal_side=Direction.debit)
        db.add(cash_acc)
        db.flush()
        custody = Custody(holder_type=HolderType.rep, rep_id=world["rep_a"],
                          account_id=cash_acc.id)
        db.add(custody)
    # Seed the treasury so payments have cash to draw on.
    treasury = account_resolver.treasury_account(db)
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        lines=[LineInput(treasury.id, Direction.debit, 10000),
               LineInput(account_resolver.opening_balance_equity_account(db).id,
                         Direction.credit, 10000)])
    # Raise a 500 receivable on the customer so there is something to collect. Dated at the
    # start of the year, like a real opening balance — statement windows must carry it in.
    cust_acc = db.scalar(__import__("sqlalchemy").select(CustomerAccount).where(
        CustomerAccount.customer_id == customer.id))
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        entry_date=__import__("datetime").date(2026, 1, 1),
        lines=[LineInput(cust_acc.account_id, Direction.debit, 500),
               LineInput(account_resolver.opening_balance_equity_account(db).id,
                         Direction.credit, 500)])
    db.commit()
    return {"customer_id": customer.id, "supplier_id": supplier.id,
            "rep_id": world["rep_a"], "admin": login("admin"), "rep": login("rep_a")}


def _balance(client, headers, customer_id):
    r = client.get(f"/api/v1/customers/{customer_id}/account", headers=headers)
    assert r.status_code == 200, r.text
    return float(r.json()["balance"])


def test_receipt_settles_customer_receivable(client, party):
    admin = party["admin"]
    assert _balance(client, admin, party["customer_id"]) == 500.0
    r = client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": party["customer_id"], "amount": "200",
        "voucher_date": "2026-07-20", "reference": "إيصال 12"})
    assert r.status_code == 201, r.text
    assert r.json()["document_number"] == "RCV-000001"
    assert _balance(client, admin, party["customer_id"]) == 300.0  # settled


def test_payment_reduces_supplier_payable_and_guards_cash(client, party):
    admin = party["admin"]
    r = client.post("/api/v1/vouchers/payments", headers=admin, json={
        "supplier_id": party["supplier_id"], "amount": "400"})
    assert r.status_code == 201, r.text
    assert r.json()["document_number"] == "PAY-000001"

    # Cannot pay out more cash than the treasury holds.
    over = client.post("/api/v1/vouchers/payments", headers=admin, json={
        "supplier_id": party["supplier_id"], "amount": "999999"})
    assert over.status_code == 409
    assert "غير كاف" in over.json()["detail"]["message"]


def test_rep_collects_then_hands_over_to_treasury(client, party):
    rep, admin = party["rep"], party["admin"]

    # The rep collects in the field -> cash lands in HIS custody, not the treasury.
    r = client.post("/api/v1/vouchers/receipts", headers=rep, json={
        "customer_id": party["customer_id"], "amount": "300"})
    assert r.status_code == 201, r.text

    cash = client.get(f"/api/v1/reps/{party['rep_id']}/cash-statement", headers=admin).json()
    assert float(cash["closing_balance"]) == 300.0

    # A rep cannot record the handover himself — the treasurer confirms receipt.
    assert client.post("/api/v1/vouchers/handovers", headers=rep, json={
        "rep_user_id": party["rep_id"], "amount": "300"}).status_code == 403

    # Cannot hand over more than he holds.
    over = client.post("/api/v1/vouchers/handovers", headers=admin, json={
        "rep_user_id": party["rep_id"], "amount": "500"})
    assert over.status_code == 409

    ok = client.post("/api/v1/vouchers/handovers", headers=admin, json={
        "rep_user_id": party["rep_id"], "amount": "300"})
    assert ok.status_code == 201 and ok.json()["document_number"] == "HND-000001"
    cash = client.get(f"/api/v1/reps/{party['rep_id']}/cash-statement", headers=admin).json()
    assert float(cash["closing_balance"]) == 0.0  # custody cleared


def test_customer_statement_runs_a_balance(client, party):
    admin = party["admin"]
    client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": party["customer_id"], "amount": "150"})

    s = client.get(f"/api/v1/customers/{party['customer_id']}/statement", headers=admin).json()
    assert float(s["closing_balance"]) == 350.0
    assert float(s["total_debit"]) == 500.0 and float(s["total_credit"]) == 150.0
    assert [float(ln["balance"]) for ln in s["lines"]] == [500.0, 350.0]


def test_statement_window_carries_an_opening_balance(client, party):
    admin = party["admin"]
    client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": party["customer_id"], "amount": "100",
        "voucher_date": "2026-07-20"})

    s = client.get(
        f"/api/v1/customers/{party['customer_id']}/statement?date_from=2026-07-20",
        headers=admin).json()
    assert float(s["opening_balance"]) == 500.0  # carried in from before the window
    assert float(s["closing_balance"]) == 400.0
    assert len(s["lines"]) == 1


def test_reverse_voucher_once_restores_the_balance(client, party):
    admin = party["admin"]
    vid = client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": party["customer_id"], "amount": "200"}).json()["id"]
    assert _balance(client, admin, party["customer_id"]) == 300.0

    r = client.post(f"/api/v1/vouchers/{vid}/reverse", headers=admin)
    assert r.status_code == 201 and r.json()["is_reversal"] is True
    assert _balance(client, admin, party["customer_id"]) == 500.0
    assert client.post(f"/api/v1/vouchers/{vid}/reverse", headers=admin).status_code == 409


def test_zero_or_negative_amount_rejected(client, party):
    for bad in ("0", "-50"):
        r = client.post("/api/v1/vouchers/receipts", headers=party["admin"], json={
            "customer_id": party["customer_id"], "amount": bad})
        assert r.status_code == 409


def test_rep_sees_only_own_vouchers(client, party):
    rep, admin = party["rep"], party["admin"]
    client.post("/api/v1/vouchers/receipts", headers=rep, json={
        "customer_id": party["customer_id"], "amount": "100"})
    client.post("/api/v1/vouchers/payments", headers=admin, json={
        "supplier_id": party["supplier_id"], "amount": "50"})

    rep_rows = client.get("/api/v1/vouchers", headers=rep).json()
    assert all(v["kind"] == "receipt" for v in rep_rows)
    assert len(client.get("/api/v1/vouchers", headers=admin).json()) == 2
