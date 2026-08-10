"""«على إجمالي المديونية» لعميل عنده خط زيادة — كان بيرفض يترحّل.

The merge (031) gives a customer one receivable account per product line, and a receipt against the
whole debt splits itself across them in the proportion each owes. A line the customer once overpaid
sits in CREDIT, and it was going into that proportion as a negative number: the positive line's
share then came out bigger than the whole amount, and the negative part that should have cancelled
it was dropped by the «only keep parts above zero» filter at the end.

What reached the user was «القيد مش متوازن — مدين 150.00 ودائن 150.10» on an ordinary collection.
Nothing on the screen suggested that the reason was a three-pound credit on his other line, and the
only way past it was to know to pick a family by hand.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select


def _customer_with_an_overpaid_line(client, db, inv_world, h, name="عميل عنده زيادة"):
    """عميل: خط عليه فلوس، وخط دافع فيه زيادة."""
    from src.models.customer import CustomerAccount
    from src.models.ledger import Account, AccountType, Direction
    from src.services import ledger_service
    from src.services.ledger_service import LineInput

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

    # أبيض مدين بـ 5538.81، وبولي دائن بـ 3.74 — نفس شكل العميل اللي المشكلة ظهرت عليه.
    equity = db.scalars(select(Account).where(
        Account.account_type == AccountType.opening_balance_equity)).first()
    if equity is None:
        equity = Account(account_type=AccountType.opening_balance_equity,
                         normal_side=Direction.credit, name="أرصدة افتتاحية", is_postable=True)
        db.add(equity)
        db.flush()
    ledger_service.post_entry(
        db, entry_type="opening_balance", description="رصيد افتتاحي للاختبار",
        actor_user_id=1,
        lines=[
            LineInput(held[0].account_id, Direction.debit, Decimal("5538.81")),
            LineInput(equity.id, Direction.credit, Decimal("5538.81")),
        ])
    ledger_service.post_entry(
        db, entry_type="opening_balance", description="خط دافع زيادة",
        actor_user_id=1,
        lines=[
            LineInput(equity.id, Direction.debit, Decimal("3.74")),
            LineInput(poly.id, Direction.credit, Decimal("3.74")),
        ])
    db.commit()
    return cust


def test_a_collection_on_the_whole_debt_posts_when_one_line_is_overpaid(
        client, inv_world, login, db):
    """The bug, exactly: مدين 150.00 ودائن 150.10 على تحصيل عادي."""
    h = login("admin")
    cust = _customer_with_an_overpaid_line(client, db, inv_world, h)

    res = client.post("/api/v1/vouchers/receipts", headers=h, json={
        "customer_id": cust["id"], "amount": "150.00", "on_total": True,
        "voucher_date": "2026-08-11", "payment_method": "cash"})
    assert res.status_code == 201, res.text


def test_the_line_in_credit_takes_none_of_it(client, inv_world, login, db):
    """A line the customer overpaid is owed money, not owing it — crediting it further would push
    it deeper into credit while the line he actually owes on stays untouched."""
    from src.models.customer import CustomerAccount
    from src.models.ledger import Direction, LedgerLine
    from src.models.voucher import Voucher

    h = login("admin")
    cust = _customer_with_an_overpaid_line(client, db, inv_world, h, name="عميل التوزيع")
    poly_account = db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == cust["id"],
        CustomerAccount.family == "بولي")).first().account_id

    res = client.post("/api/v1/vouchers/receipts", headers=h, json={
        "customer_id": cust["id"], "amount": "150.00", "on_total": True,
        "voucher_date": "2026-08-11"})
    assert res.status_code == 201, res.text

    voucher = db.get(Voucher, res.json()["id"])
    credited = db.scalars(select(LedgerLine).where(
        LedgerLine.entry_id == voucher.ledger_entry_id,
        LedgerLine.direction == Direction.credit)).all()
    assert sum(line.amount for line in credited) == Decimal("150.00"), \
        "المجموع المدان لازم يساوي المبلغ بالظبط"
    assert not any(line.account_id == poly_account for line in credited), \
        "الخط اللي فيه زيادة أخد نصيب من التحصيل"


def test_a_customer_whose_every_line_is_paid_up_is_still_refused(client, inv_world, login, db):
    """«على الإجمالي» has no proportion to follow when nothing is owed, and inventing one would put
    an advance payment on whichever line happened to be first.

    Narrowing the split to the lines that owe must not quietly turn this into «put it all on the
    first one» — the refusal is the useful answer, and it is what tells the cashier to pick a line.
    """
    from src.models.customer import CustomerAccount
    from src.models.ledger import Account, AccountType, Direction

    h = login("admin")
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل مش مديون", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()
    held = db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == cust["id"])).all()
    held[0].family = "أبيض"
    poly = Account(account_type=AccountType.customer_receivable, normal_side=Direction.debit)
    db.add(poly)
    db.flush()
    db.add(CustomerAccount(customer_id=cust["id"], account_id=poly.id, family="بولي"))
    db.commit()

    res = client.post("/api/v1/vouchers/receipts", headers=h, json={
        "customer_id": cust["id"], "amount": "50.00", "on_total": True,
        "voucher_date": "2026-08-11"})
    assert res.status_code != 201, res.text
