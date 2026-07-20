"""Sub-treasuries, cash transfers, expense vouchers and the period lock (019)."""
from __future__ import annotations

import pytest


@pytest.fixture()
def money(client, world, login, db):
    """Default safe funded with 10,000 plus a postable expense account."""
    from src.models.ledger import Account, AccountNature, Direction
    from src.services import account_resolver, ledger_service, treasury_service
    from src.services.ledger_service import LineInput

    main = treasury_service.default_treasury(db)
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        lines=[LineInput(main.account_id, Direction.debit, 10000),
               LineInput(account_resolver.opening_balance_equity_account(db).id,
                         Direction.credit, 10000)])
    rent = Account(code="5101", name="إيجارات", nature=AccountNature.expense,
                   normal_side=Direction.debit, is_postable=True,
                   account_type=__import__("src.models.ledger", fromlist=["AccountType"])
                   .AccountType.user_defined)
    group = Account(code="5100", name="مصروفات إدارية", nature=AccountNature.expense,
                    normal_side=Direction.debit, is_postable=False,
                    account_type=rent.account_type)
    revenue = Account(code="4100", name="إيراد آخر", nature=AccountNature.income,
                      normal_side=Direction.credit, is_postable=True,
                      account_type=rent.account_type)
    db.add_all([rent, group, revenue])
    db.commit()
    return {"admin": login("admin"), "rep": login("rep_a"), "main_id": main.id,
            "rent_id": rent.id, "group_id": group.id, "revenue_id": revenue.id}


def _treasuries(client, headers):
    r = client.get("/api/v1/treasuries", headers=headers)
    assert r.status_code == 200, r.text
    return {t["name"]: t for t in r.json()}


def test_legacy_safe_is_adopted_as_default(client, money):
    rows = _treasuries(client, money["admin"])
    assert "الخزينة الرئيسية" in rows
    main = rows["الخزينة الرئيسية"]
    assert main["is_default"] is True and float(main["balance"]) == 10000.0


def test_create_branch_safe_and_transfer_between_them(client, money):
    admin = money["admin"]
    r = client.post("/api/v1/treasuries", headers=admin,
                    json={"name": "خزينة فرع طنطا", "kind": "cash"})
    assert r.status_code == 201, r.text
    branch_safe = r.json()
    assert float(branch_safe["balance"]) == 0.0

    t = client.post("/api/v1/vouchers/transfers", headers=admin, json={
        "from_treasury_id": money["main_id"], "to_treasury_id": branch_safe["id"],
        "amount": "2500", "reference": "تحويل يومي"})
    assert t.status_code == 201, t.text
    assert t.json()["document_number"] == "TRF-000001"

    rows = _treasuries(client, admin)
    assert float(rows["الخزينة الرئيسية"]["balance"]) == 7500.0
    assert float(rows["خزينة فرع طنطا"]["balance"]) == 2500.0


def test_transfer_guards(client, money):
    admin = money["admin"]
    other = client.post("/api/v1/treasuries", headers=admin,
                        json={"name": "خزينة ثانية"}).json()
    same = client.post("/api/v1/vouchers/transfers", headers=admin, json={
        "from_treasury_id": money["main_id"], "to_treasury_id": money["main_id"],
        "amount": "10"})
    assert same.status_code == 409
    over = client.post("/api/v1/vouchers/transfers", headers=admin, json={
        "from_treasury_id": money["main_id"], "to_treasury_id": other["id"],
        "amount": "99999"})
    assert over.status_code == 409 and "غير كاف" in over.json()["detail"]["message"]


def test_expense_voucher_posts_against_an_expense_account(client, money):
    admin = money["admin"]
    r = client.post("/api/v1/vouchers/expenses", headers=admin, json={
        "expense_account_id": money["rent_id"], "amount": "1200",
        "description": "إيجار المخزن"})
    assert r.status_code == 201, r.text
    assert r.json()["document_number"] == "EXP-000001"
    assert float(_treasuries(client, admin)["الخزينة الرئيسية"]["balance"]) == 8800.0


def test_expense_rejects_wrong_account_kinds(client, money):
    admin = money["admin"]
    # Income account -> not an expense.
    bad = client.post("/api/v1/vouchers/expenses", headers=admin, json={
        "expense_account_id": money["revenue_id"], "amount": "10"})
    assert bad.status_code == 409 and "مصروفات" in bad.json()["detail"]["message"]
    # Group (non-postable) account.
    grp = client.post("/api/v1/vouchers/expenses", headers=admin, json={
        "expense_account_id": money["group_id"], "amount": "10"})
    assert grp.status_code == 409 and "تجميعي" in grp.json()["detail"]["message"]


def test_reps_cannot_touch_office_cash_operations(client, money):
    rep = money["rep"]
    assert client.post("/api/v1/vouchers/expenses", headers=rep, json={
        "expense_account_id": money["rent_id"], "amount": "10"}).status_code == 403
    assert client.post("/api/v1/vouchers/transfers", headers=rep, json={
        "from_treasury_id": money["main_id"], "to_treasury_id": money["main_id"],
        "amount": "10"}).status_code == 403
    assert client.post("/api/v1/treasuries", headers=rep,
                       json={"name": "خزينة المندوب"}).status_code == 403


def test_period_lock_blocks_postings_on_or_before_the_date(client, money):
    admin = money["admin"]
    assert client.get("/api/v1/period-lock", headers=admin).json()["locked_through"] is None

    r = client.post("/api/v1/period-lock", headers=admin,
                    json={"locked_through": "2026-07-31", "note": "إقفال يوليو"})
    assert r.status_code == 201 and r.json()["locked_through"] == "2026-07-31"

    blocked = client.post("/api/v1/vouchers/expenses", headers=admin, json={
        "expense_account_id": money["rent_id"], "amount": "50",
        "voucher_date": "2026-07-15"})
    assert blocked.status_code == 409
    assert "الفترة مقفلة" in blocked.json()["detail"]["message"]

    # A later date still posts.
    ok = client.post("/api/v1/vouchers/expenses", headers=admin, json={
        "expense_account_id": money["rent_id"], "amount": "50",
        "voucher_date": "2026-08-05"})
    assert ok.status_code == 201


def test_only_admin_or_accountant_locks_the_period(client, money, login):
    assert client.post("/api/v1/period-lock", headers=login("bm_a"),
                       json={"locked_through": "2026-07-31"}).status_code == 403
    assert client.post("/api/v1/period-lock", headers=login("acct"),
                       json={"locked_through": "2026-06-30"}).status_code == 201


def test_default_safe_cannot_be_deactivated_nor_one_holding_cash(client, money):
    admin = money["admin"]
    r = client.patch(f"/api/v1/treasuries/{money['main_id']}", headers=admin,
                     json={"active": False})
    assert r.status_code == 409 and "الافتراضية" in r.json()["detail"]["message"]

    other = client.post("/api/v1/treasuries", headers=admin,
                        json={"name": "خزينة برصيد"}).json()
    client.post("/api/v1/vouchers/transfers", headers=admin, json={
        "from_treasury_id": money["main_id"], "to_treasury_id": other["id"],
        "amount": "100"})
    held = client.patch(f"/api/v1/treasuries/{other['id']}", headers=admin,
                        json={"active": False})
    assert held.status_code == 409 and "رصيد" in held.json()["detail"]["message"]


def test_receipt_can_target_a_named_safe(client, money, world, db, login):
    from src.models.customer import CustomerAccount
    from src.models.ledger import Direction
    from src.services import account_resolver, customer_service, ledger_service
    from src.services.ledger_service import LineInput

    admin = money["admin"]
    result = customer_service.create_customer(
        db, name="عميل الخزينة", customer_type="trader", rep_id=world["rep_a"],
        territory_id=world["terr_a"], phone=None, actor_user_id=world["admin"])
    acc = db.scalar(__import__("sqlalchemy").select(CustomerAccount).where(
        CustomerAccount.customer_id == result.customer.id))
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"],
        lines=[LineInput(acc.account_id, Direction.debit, 300),
               LineInput(account_resolver.opening_balance_equity_account(db).id,
                         Direction.credit, 300)])
    db.commit()

    safe = client.post("/api/v1/treasuries", headers=admin,
                       json={"name": "خزينة التحصيل"}).json()
    r = client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": result.customer.id, "amount": "300", "treasury_id": safe["id"]})
    assert r.status_code == 201, r.text
    assert r.json()["treasury_id"] == safe["id"]
    assert float(_treasuries(client, admin)["خزينة التحصيل"]["balance"]) == 300.0
