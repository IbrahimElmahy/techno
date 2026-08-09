"""فاتورة المرتجع لازم تعرف بترجّع على أنهي مديونية — زي فاتورة البيع بالظبط.

The invoice has carried `family` since the merge: أبيض or بولي, the customer's receivable line it
posts to. The return did not. Two consequences, and the second is the worse one:

* A standalone return for a customer holding two accounts was **refused** — «العميل عنده أكتر من
  حساب (أبيض / بولي) — لازم تحدد النوع» — because the service resolved the account and the payload
  had no field to name it. The screen could not take a return from exactly the customers the merge
  had just joined.
* And nothing on the document said which debt a refund reduced, so «رجّعنا له على أنهي حساب؟» had
  no answer anywhere afterwards.

An invoice-bound return does NOT ask: it copies the family off the invoice. Goods go back where
they came from and so does the money — a refund that reduced a different line than the sale raised
would leave both wrong by the same amount, and both would look plausible.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select


def _split_customer(client, db, inv_world, h, name):
    from src.models.customer import CustomerAccount
    from src.models.ledger import Account, AccountType, Direction

    cust = client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()
    held = db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == cust["id"])).all()
    held[0].family = "أبيض"
    poly = Account(account_type=AccountType.customer_receivable, normal_side=Direction.debit)
    db.add(poly)
    db.flush()
    db.add(CustomerAccount(customer_id=cust["id"], account_id=poly.id, family="بولي"))
    db.commit()
    return cust


def _stocked_item(client, h, wh, name="صنف المرتجع", price="100"):
    item = client.post("/api/v1/items", headers=h, json={
        "name": name, "kind": "product", "unit_of_measure": "piece",
        "sale_price": price}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": f"مورد {name}"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "400", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "40"}]})
    return item


def test_a_standalone_return_can_name_the_debt_it_credits(client, inv_world, login, db):
    """The refusal, gone: the payload takes the family the service always accepted."""
    h = login("admin")
    wh = inv_world["central_wh"]
    cust = _split_customer(client, db, inv_world, h, "عميل مرتجع بعيلتين")
    item = _stocked_item(client, h, wh)

    res = client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"], "family": "بولي",
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "0", "credit_reduction": "100",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}]})
    assert res.status_code == 201, res.text
    assert res.json()["family"] == "بولي", "المستند مش قايل رجّع على أنهي حساب"


def test_it_credits_the_account_it_named(client, inv_world, login, db):
    """Naming it on the document and posting it somewhere else would be worse than not asking."""
    from src.models.customer import CustomerAccount
    from src.services import ledger_service

    h = login("admin")
    wh = inv_world["central_wh"]
    cust = _split_customer(client, db, inv_world, h, "عميل الترحيل")
    item = _stocked_item(client, h, wh, name="صنف الترحيل")

    accounts = {a.family: a.account_id for a in db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == cust["id"])).all()}
    before = {f: ledger_service.balance_of(db, aid) for f, aid in accounts.items()}

    res = client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"], "family": "أبيض",
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "0", "credit_reduction": "100",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}]})
    assert res.status_code == 201, res.text
    db.expire_all()

    after = {f: ledger_service.balance_of(db, aid) for f, aid in accounts.items()}
    assert after["أبيض"] == before["أبيض"] - Decimal("100"), "المديونية المختارة ماقلّتش"
    assert after["بولي"] == before["بولي"], "التانية اتحركت — الفلوس راحت على الحساب الغلط"


def test_a_return_against_an_invoice_inherits_its_family(client, inv_world, login, db):
    """It does not ask, and it must not: the refund reduces the debt the sale raised.

    Crediting a different line would leave both balances wrong by the same amount, and both would
    look perfectly plausible.
    """
    h = login("admin")
    wh = inv_world["central_wh"]
    cust = _split_customer(client, db, inv_world, h, "عميل الفاتورة والمرتجع")
    item = _stocked_item(client, h, wh, name="صنف الفاتورة")

    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"], "family": "بولي",
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "0", "credit_amount": "200",
        "lines": [{"item_id": item["id"], "quantity": "2", "unit_price": "100"}]})
    assert sale.status_code == 201, sale.text

    res = client.post(f"/api/v1/sales/{sale.json()['id']}/returns", headers=h,
                      json={"lines": [{"item_id": item["id"], "quantity": "1"}]})
    assert res.status_code == 201, res.text
    assert res.json()["family"] == "بولي", "المرتجع رجع على حساب غير اللي البيع اتسجّل عليه"


def test_a_customer_with_one_account_still_needs_no_answer(client, inv_world, login, db):
    """Most customers were never split. Asking them the question would be asking for the only
    possible answer, so the field stays empty and the return still posts."""
    h = login("admin")
    wh = inv_world["central_wh"]
    item = _stocked_item(client, h, wh, name="صنف العميل العادي")
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل بحساب واحد", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()

    res = client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "0", "credit_reduction": "100",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}]})
    assert res.status_code == 201, res.text
    assert res.json()["family"] is None


def test_the_list_carries_the_family_back(client, inv_world, login, db):
    """A field that goes in and never comes back is a field nobody can act on."""
    h = login("admin")
    wh = inv_world["central_wh"]
    cust = _split_customer(client, db, inv_world, h, "عميل القايمة")
    item = _stocked_item(client, h, wh, name="صنف القايمة")

    client.post("/api/v1/sales/returns", headers=h, json={
        "customer_id": cust["id"], "family": "أبيض",
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_refund": "0", "credit_reduction": "100",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}]})

    rows = client.get("/api/v1/sales/returns", headers=h).json()
    mine = [r for r in rows if r["customer_id"] == cust["id"]]
    assert mine and mine[0]["family"] == "أبيض", mine
