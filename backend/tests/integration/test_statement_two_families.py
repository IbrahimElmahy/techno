"""كشف حساب عميل عنده أكتر من حساب — كان بيرفض يفتح.

The merge gave a customer one receivable account per product line (031), and كشف الحساب resolved
«his account» the same way a voucher does. A voucher REFUSES when there is more than one, and that
refusal is right: money credited to «أبيض» that belonged to «بولي» is a silent, untraceable error.

The statement inherited it, so the screen answered 404 «العميل عنده أكتر من حساب (أبيض / بولي) —
لازم تحدد النوع» for exactly the customers the merge had just joined, with nothing on the screen
offering the choice it demanded. Reading is not posting: «كل المديونية» is not ambiguous, it is
both accounts on one running balance.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select


def _two_family_customer(client, db, inv_world, h, name="عميل بعيلتين"):
    """A customer holding an أبيض account and a بولي account — what the merge produces."""
    from src.models.customer import CustomerAccount
    from src.models.ledger import Account, AccountType, Direction

    cust = client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()

    held = db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == cust["id"])).all()
    assert held, "العميل اتعمل من غير حساب ذمم"
    held[0].family = "أبيض"

    poly = Account(account_type=AccountType.customer_receivable, normal_side=Direction.debit)
    db.add(poly)
    db.flush()
    db.add(CustomerAccount(customer_id=cust["id"], account_id=poly.id, family="بولي"))
    db.commit()
    return cust


def test_the_statement_opens_for_a_customer_with_two_accounts(client, inv_world, login, db):
    """The bug, exactly: it used to be 404 with «لازم تحدد النوع»."""
    h = login("admin")
    cust = _two_family_customer(client, db, inv_world, h)

    res = client.get(f"/api/v1/customers/{cust['id']}/statement", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    assert "lines" in body


def test_it_offers_the_choice_it_used_to_demand(client, inv_world, login, db):
    """«لازم تحدد النوع» from a screen with no way to specify it is a dead end.

    The families travel with the statement so the screen can show أبيض and بولي beside the total,
    rather than making the reader open three statements and add them up.
    """
    h = login("admin")
    cust = _two_family_customer(client, db, inv_world, h, name="عميل الاختيار")

    body = client.get(f"/api/v1/customers/{cust['id']}/statement", headers=h).json()
    families = {f["family"] for f in body["families"]}
    assert families == {"أبيض", "بولي"}, body["families"]
    for f in body["families"]:
        assert f["account_id"], "عيلة من غير حساب"
        assert "balance" in f, "عيلة من غير رصيد — الشاشة مش هتقدر تعرضها جنب الإجمالي"
    assert body["family"] is None, "من غير اختيار يبقى الكشف للكل"


def test_asking_for_one_family_narrows_it(client, inv_world, login, db):
    h = login("admin")
    cust = _two_family_customer(client, db, inv_world, h, name="عميل عيلة واحدة")

    body = client.get(f"/api/v1/customers/{cust['id']}/statement",
                      headers=h, params={"family": "بولي"}).json()
    assert body["family"] == "بولي"
    poly = next(f for f in body["families"] if f["family"] == "بولي")
    assert body["account_id"] == poly["account_id"]


def test_a_family_he_does_not_have_is_still_refused(client, inv_world, login, db):
    """Narrowing to a line he has no account for has no answer — that one IS ambiguous."""
    h = login("admin")
    cust = _two_family_customer(client, db, inv_world, h, name="عميل بلا عيلة تالتة")

    res = client.get(f"/api/v1/customers/{cust['id']}/statement",
                     headers=h, params={"family": "أخضر"})
    assert res.status_code == 404, res.text


def test_the_combined_statement_is_the_two_added_up(client, inv_world, login, db):
    """The arithmetic, not just the status code.

    A combined statement that quietly dropped one account's lines would still answer 200 and would
    be worse than the 404: a customer's debt understated with nothing saying so.
    """
    from src.models.customer import CustomerAccount

    h = login("admin")
    cust = _two_family_customer(client, db, inv_world, h, name="عميل الحساب المجمّع")
    assert len(db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == cust["id"])).all()) == 2

    # Money on BOTH lines, different amounts, so a dropped account cannot pass unnoticed.
    treasury = client.get("/api/v1/treasuries", headers=h).json()[0]
    for fam, amount in (("أبيض", "300"), ("بولي", "125")):
        res = client.post("/api/v1/vouchers/receipts", headers=h, json={
            "customer_id": cust["id"], "family": fam, "amount": amount,
            "payment_method": "cash", "treasury_id": treasury["id"]})
        assert res.status_code in (200, 201), res.text

    combined = client.get(f"/api/v1/customers/{cust['id']}/statement", headers=h).json()
    white = client.get(f"/api/v1/customers/{cust['id']}/statement",
                       headers=h, params={"family": "أبيض"}).json()
    poly = client.get(f"/api/v1/customers/{cust['id']}/statement",
                      headers=h, params={"family": "بولي"}).json()

    assert len(combined["lines"]) == len(white["lines"]) + len(poly["lines"])
    assert Decimal(combined["closing_balance"]) == (
        Decimal(white["closing_balance"]) + Decimal(poly["closing_balance"]))
    # And the per-family balances agree with the per-family statements.
    for f in combined["families"]:
        one = white if f["family"] == "أبيض" else poly
        assert Decimal(f["balance"]) == Decimal(one["closing_balance"])


def test_a_customer_with_one_account_is_unchanged(client, inv_world, login, db):
    """Most customers were never split, and their statement must read exactly as before."""
    h = login("admin")
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل عادي", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()
    db.commit()

    body = client.get(f"/api/v1/customers/{cust['id']}/statement", headers=h).json()
    assert len(body["families"]) == 1
    assert body["account_id"] == body["families"][0]["account_id"]
