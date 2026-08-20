"""مردود شرا مستقل — أصناف راجعة لمورد من غير فاتورة (٨).

الشركة بترجّع بضاعة لمورد من غير ما تكون عارفة — أو مهتمة — بأنهي فاتورة جابتها. ربط كل مردود
بفاتورة كان معناه حاجتين: اللي بيرجّع لازم يدوّر على الفاتورة الأصلية الأول، وبضاعة اتجمّعت من
فواتير كتير ماينفعش ترجع في مستند واحد.

نفس اللي مرتجع البيع عمله في ٠٢٨. الخواص اللي بتتقاس هنا:

* **البضاعة بتخرج من المخزن اللي اتقال عليه** — مفيش فاتورة تقول منين، فالمستند بيتسأل.
* **السعر بيتكتب مش بيتقرا.** البضاعة بترجع بالسعر المتفق عليه دلوقتي، مش لازم سعر شرائها.
* **اللي على الشركة للمورد بينقص بالقيمة**، وحساب المشتريات بيتقفل بيها.
* **الرصيد هو الحد الوحيد.** مفيش فاتورة تقول «اتشرى كام»، فاللي مش موجود في المخزن مايرجعش.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def stocked(client, inv_world, login):
    """مورد وصنف وعشرة في المخزن — من فاتورة شرا عادية."""
    h = login("admin")
    supplier = client.post("/api/v1/suppliers", headers=h,
                           json={"name": "مورد مستقل"}).json()
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف راجع", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50"}).json()
    res = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier["id"],
        "location": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "100"}],
        "cash_amount": "1000", "credit_amount": "0",
    })
    assert res.status_code == 201, res.text
    return {**inv_world, "h": h, "supplier": supplier, "item": item}


def _return(client, s, **over):
    body = {
        "supplier_id": s["supplier"]["id"],
        "location": {"location_kind": "warehouse", "location_id": s["branch_wh"]},
        "lines": [{"item_id": s["item"]["id"], "quantity": "3", "unit_price": "90"}],
    }
    body.update(over)
    return client.post("/api/v1/purchases/returns", headers=s["h"], json=body)


def _on_hand(client, s):
    res = client.get("/api/v1/stock/on-hand", headers=s["h"], params={
        "item_id": s["item"]["id"], "location_kind": "warehouse",
        "location_id": s["branch_wh"]})
    return Decimal(str(res.json()["on_hand"]))


def test_a_return_needs_no_invoice(client, stocked):
    """أهم فحص: المستند بيتسجّل من غير `purchase_invoice_id` خالص."""
    res = _return(client, stocked)
    assert res.status_code == 201, res.text
    assert res.json()["document_number"].startswith("PRET")


def test_the_goods_leave_the_warehouse_named_on_the_document(client, stocked):
    assert _on_hand(client, stocked) == Decimal("10.000")
    assert _return(client, stocked).status_code == 201
    assert _on_hand(client, stocked) == Decimal("7.000")


def test_the_price_is_written_not_read_from_a_purchase(client, stocked):
    """اترجّع بـ٩٠ مع إنه اتشرى بـ١٠٠ — القيمة بتتبع اللي اتكتب."""
    res = _return(client, stocked)
    assert res.status_code == 201, res.text
    row = client.get("/api/v1/purchases/returns", headers=stocked["h"]).json()[0]
    assert Decimal(row["value"]) == Decimal("270.00")  # ٣ × ٩٠


def test_what_the_company_owes_the_supplier_drops(client, stocked):
    """الأثر المحاسبي — بيتقاس من كشف حساب المورد مش بقراية صفوف."""
    h = stocked["h"]
    before = client.get(f"/api/v1/suppliers/{stocked['supplier']['id']}/statement",
                        headers=h).json()
    assert _return(client, stocked).status_code == 201
    after = client.get(f"/api/v1/suppliers/{stocked['supplier']['id']}/statement",
                       headers=h).json()
    # المردود بيقلّل اللي على الشركة بـ٢٧٠. حساب المورد طبيعته دائنة، فالمدين بيقلّله —
    # وده اللي بيبان كزيادة في المدين على الكشف.
    assert (Decimal(str(after["total_debit"])) - Decimal(str(before["total_debit"]))
            == Decimal("270.00"))


def test_more_than_the_warehouse_holds_is_refused(client, stocked):
    """مفيش فاتورة تقول «اتشرى كام» — فالحد الوحيد هو الرصيد."""
    res = _return(client, stocked, lines=[
        {"item_id": stocked["item"]["id"], "quantity": "50", "unit_price": "90"}])
    assert res.status_code == 409, res.text


def test_an_empty_return_is_refused(client, stocked):
    assert _return(client, stocked, lines=[]).status_code == 409


def test_it_shows_in_the_register_with_its_supplier(client, stocked):
    """المستقل مالوش فاتورة، فالمورد بيتقرا منه هو مش منها."""
    assert _return(client, stocked).status_code == 201
    row = client.get("/api/v1/purchases/returns", headers=stocked["h"]).json()[0]
    assert row["purchase_invoice_id"] is None
    assert row["supplier_name"] == "مورد مستقل"


def test_the_detail_carries_the_line_prices(client, stocked):
    """الورقة المطبوعة محتاجة قيمة على السطر مش كمية بلا سعر."""
    created = _return(client, stocked).json()
    got = client.get(f"/api/v1/purchases/returns/{created['id']}",
                     headers=stocked["h"]).json()
    line = got["lines"][0]
    assert Decimal(line["unit_price"]) == Decimal("90.00")
    assert Decimal(line["line_total"]) == Decimal("270.00")


def test_a_standalone_return_can_be_reversed_like_any_other(client, stocked):
    created = _return(client, stocked).json()
    assert _on_hand(client, stocked) == Decimal("7.000")
    res = client.post(f"/api/v1/purchases/returns/{created['id']}/reverse",
                      headers=stocked["h"])
    assert res.status_code == 200, res.text
    assert _on_hand(client, stocked) == Decimal("10.000")


def test_the_invoice_bound_return_still_works(client, stocked):
    """الطريق القديم مااتكسرش — هو الصح لما البضاعة راجعة من شحنة بعينها."""
    h = stocked["h"]
    invoice = client.get("/api/v1/purchases", headers=h).json()[0]
    res = client.post(f"/api/v1/purchases/{invoice['id']}/returns", headers=h, json={
        "lines": [{"item_id": stocked["item"]["id"], "quantity": "2"}]})
    assert res.status_code == 201, res.text
    row = client.get("/api/v1/purchases/returns", headers=h).json()[0]
    assert row["purchase_invoice_id"] == invoice["id"]
