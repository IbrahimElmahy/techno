"""فاتورة الشرا بقت نسخة من فاتورة البيع — خصم على السطر وخصم على الفاتورة وضريبة.

The purchase invoice used to be a bare sum: quantity × price, added up, and that was the total. The
sale had a discount on each line, a second discount on the whole invoice, and tax on top — so the
same negotiation, written on the buying side, had nowhere to go and ended up adjusted into the unit
prices by hand.

The three are applied in the sale's order: a line discount comes off that line, the line totals are
summed into `gross`, the invoice discount comes off `gross`, and tax sits on the result.

A percentage discount is linear, so taking the invoice one off the sum or off each line reaches the
same figure — the order is worth stating because it is what the sale does and what the supplier's
own invoice shows, not because the arithmetic diverges. Where it CAN diverge is rounding: money is
rounded once at `gross` and once at `net`, not per intermediate step.

The purchase deliberately carries NO invoice expenses: the client books carriage and customs on
their own, outside the document.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


def _item(client, h, name="Steel"):
    return client.post("/api/v1/items", headers=h,
                       json={"name": name, "kind": "raw_material",
                             "unit_of_measure": "kg", "purchase_price": "10"}).json()


def _supplier(client, h):
    return client.post("/api/v1/suppliers", headers=h, json={"name": "Acme"}).json()


def _buy(client, h, inv_world, *, lines, cash, credit=None, variable="0"):
    """فاتورة شرا — بترجّع الرد زي ما هو عشان الاختبار يقرا الأرقام."""
    sup = _supplier(client, h)
    return client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "cash_amount": str(cash),
        "credit_amount": str(credit if credit is not None else "0"),
        "variable_discount_pct": variable,
        "lines": lines,
    })


def test_a_line_discount_comes_off_that_line(client, inv_world, login):
    h = login("admin")
    # 10 × 100 = 1000، وخصم 10٪ على السطر = 900.
    res = _buy(client, h, inv_world, cash="900", lines=[{
        "item_id": _item(client, h)["id"], "quantity": "10",
        "unit_price": "100", "discount_pct": "10"}])
    assert res.status_code == 201, res.text
    body = res.json()
    assert Decimal(body["gross"]) == Decimal("900.00")
    assert Decimal(body["total"]) == Decimal("900.00")


def test_both_discounts_apply_in_the_right_order(client, inv_world, login):
    """السطر الأول، وبعدين الفاتورة على المجموع.

    Two lines, one of them discounted, then a discount on the whole invoice — the shape of a real
    negotiation. What is checked is that BOTH are applied and land on the documented figures, not
    that one order beats another: a percentage discount is linear, so off-the-sum and off-each-line
    agree. What would fail here is one of the two discounts being dropped, or the invoice discount
    landing on the pre-line-discount total.
    """
    h = login("admin")
    # سطر 1: 5 × 100 = 500، خصم سطر 20٪ ⇒ 400. سطر 2: 5 × 100 = 500 من غير خصم.
    # gross = 900، خصم فاتورة 10٪ ⇒ net = 810.
    res = _buy(client, h, inv_world, cash="810", variable="10", lines=[
        {"item_id": _item(client, h)["id"], "quantity": "5", "unit_price": "100",
         "discount_pct": "20"},
        {"item_id": _item(client, h, "Copper")["id"], "quantity": "5", "unit_price": "100"},
    ])
    assert res.status_code == 201, res.text
    body = res.json()
    assert Decimal(body["gross"]) == Decimal("900.00")
    assert Decimal(body["net"]) == Decimal("810.00")
    assert Decimal(body["total"]) == Decimal("810.00")


def test_the_money_paid_has_to_equal_what_the_invoice_says(client, inv_world, login):
    """Cash + credit is checked against the FINAL figure, not the gross — otherwise a discounted
    invoice would be refused for being paid the right amount."""
    h = login("admin")
    res = _buy(client, h, inv_world, cash="1000", variable="10", lines=[
        {"item_id": _item(client, h)["id"], "quantity": "10", "unit_price": "100"}])
    assert res.status_code == 409, res.text
    assert "النقدي" in res.text


def test_a_discount_of_a_hundred_percent_or_more_is_refused(client, inv_world, login):
    """A line at 100% off is free goods, which is a different document; above 100% is money flowing
    the wrong way and would post a negative purchase."""
    h = login("admin")
    for pct in ("100", "150"):
        res = _buy(client, h, inv_world, cash="0", lines=[{
            "item_id": _item(client, h)["id"], "quantity": "1",
            "unit_price": "100", "discount_pct": pct}])
        assert res.status_code == 409, f"{pct}٪ عدّت: {res.text}"


def test_a_negative_invoice_discount_is_refused(client, inv_world, login):
    """A negative discount is a surcharge wearing a discount's name — if the supplier is charging
    more, that belongs in the price."""
    h = login("admin")
    res = _buy(client, h, inv_world, cash="1100", variable="-10", lines=[{
        "item_id": _item(client, h)["id"], "quantity": "10", "unit_price": "100"}])
    assert res.status_code == 409, res.text


def test_an_invoice_with_no_discounts_is_unchanged(client, inv_world, login):
    """The whole feature is optional. A purchase written the way they were written before has to
    come out at exactly the same number."""
    h = login("admin")
    res = _buy(client, h, inv_world, cash="1000", lines=[{
        "item_id": _item(client, h)["id"], "quantity": "10", "unit_price": "100"}])
    assert res.status_code == 201, res.text
    body = res.json()
    assert Decimal(body["gross"]) == Decimal("1000.00")
    assert Decimal(body["net"]) == Decimal("1000.00")
    assert Decimal(body["total"]) == Decimal("1000.00")


def test_the_line_keeps_its_own_discount(client, inv_world, login, db):
    """Stored on the line, not folded into the price: «اتفقنا على عشرة في المية» is a fact about the
    deal, and a unit price quietly reduced by hand cannot be read back as one."""
    from src.models.purchasing import PurchaseInvoice

    h = login("admin")
    res = _buy(client, h, inv_world, cash="900", lines=[{
        "item_id": _item(client, h)["id"], "quantity": "10",
        "unit_price": "100", "discount_pct": "10"}])
    assert res.status_code == 201, res.text

    inv = db.get(PurchaseInvoice, res.json()["id"])
    line = inv.lines[0]
    assert Decimal(str(line.unit_price)) == Decimal("100.00"), "السعر اتعدّل بدل ما الخصم يتسجّل"
    assert Decimal(str(line.discount_pct)) == Decimal("10")


@pytest.mark.parametrize("field", ["gross", "net", "tax_amount"])
def test_the_new_figures_are_returned(client, inv_world, login, field):
    """A screen that cannot read them back cannot show a total the buyer can check."""
    h = login("admin")
    res = _buy(client, h, inv_world, cash="1000", lines=[{
        "item_id": _item(client, h)["id"], "quantity": "10", "unit_price": "100"}])
    assert res.status_code == 201, res.text
    assert field in res.json(), f"{field} مش راجع من الـAPI"
