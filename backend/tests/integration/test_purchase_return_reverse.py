"""عكس مردود الشرا — التعديل عكس وكتابة من جديد، زي الفاتورة.

المردود المرحّل ماكانش ليه أي طريق للتعديل ولا للإلغاء: اتكتب غلط يفضل غلط. البضاعة اتحركت
والقيد اتكتب، فالتعديل في مكانه مستحيل — لكن العكس كان ناقص خالص.

الخواص اللي الملف ده بيدافع عنها:

* **البضاعة بترجع لنفس المخزن اللي خرجت منه.** `purchase_return_out` طلّعها من مخزن بعينه؛
  رجوعها لمخزن تاني بيخلّي الرصيدين الاتنين غلط.
* **القيد بيتعكس بقيد مضاد، مش بمسح.** الدفتر append-only.
* **الكمية بترجع تتاح للمردود من جديد.** مردود معكوس بضاعته رجعت — عدّه في «اترجّع كام» بيقفل
  الفاتورة على مردود مالوش أثر.
* **الصف بيفضل موجود ومابيظهرش في السجل.** رقم المستند اتصرف والقيد المضاد بيشاور عليه.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def returned(client, inv_world, login):
    """فاتورة شرا ومردود جزئي عليها."""
    h = login("admin")
    supplier = client.post("/api/v1/suppliers", headers=h,
                           json={"name": "مورد المردود"}).json()
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف المردود", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50"}).json()
    inv = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier["id"],
        "location": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "100"}],
        "cash_amount": "1000", "credit_amount": "0",
    })
    assert inv.status_code == 201, inv.text
    invoice = inv.json()

    ret = client.post(f"/api/v1/purchases/{invoice['id']}/returns", headers=h, json={
        "lines": [{"item_id": item["id"], "quantity": "4"}],
    })
    assert ret.status_code == 201, ret.text
    return {**inv_world, "h": h, "item": item, "invoice": invoice,
            "return_id": ret.json()["id"]}


def _on_hand(client, s):
    res = client.get("/api/v1/stock/on-hand", headers=s["h"], params={
        "item_id": s["item"]["id"], "location_kind": "warehouse",
        "location_id": s["branch_wh"]})
    assert res.status_code == 200, res.text
    return Decimal(str(res.json()["on_hand"]))


def test_the_goods_come_back_to_the_warehouse_they_left(client, returned):
    """اتشرى ١٠، رجع ٤ فبقى ٦، والعكس بيرجّعه ١٠."""
    assert _on_hand(client, returned) == Decimal("6.000")

    res = client.post(f"/api/v1/purchases/returns/{returned['return_id']}/reverse",
                      headers=returned["h"])
    assert res.status_code == 200, res.text
    assert _on_hand(client, returned) == Decimal("10.000")


def test_a_reversed_return_leaves_the_register(client, returned):
    """مابيظهرش كحركة — وهو لسه مستند في الدفتر."""
    before = client.get("/api/v1/purchases/returns", headers=returned["h"]).json()
    assert len(before) == 1

    client.post(f"/api/v1/purchases/returns/{returned['return_id']}/reverse",
                headers=returned["h"])
    after = client.get("/api/v1/purchases/returns", headers=returned["h"]).json()
    assert after == []


def test_the_quantity_becomes_returnable_again(client, returned):
    """أهم فحص: مردود معكوس مايقفلش الكمية.

    من غير ده، «اتشرى ١٠ واترجّع ٤» بتفضل محسوبة بعد ما الأربعة رجعوا المخزن — فتحاول ترجّع
    عشرة وتترفض من غير سبب باين.
    """
    h = returned["h"]
    # قبل العكس: فاضل ٦ بس.
    over = client.post(f"/api/v1/purchases/{returned['invoice']['id']}/returns", headers=h,
                       json={"lines": [{"item_id": returned["item"]["id"], "quantity": "10"}]})
    assert over.status_code == 409, over.text

    client.post(f"/api/v1/purchases/returns/{returned['return_id']}/reverse", headers=h)

    # بعد العكس: العشرة كلهم متاحين.
    again = client.post(f"/api/v1/purchases/{returned['invoice']['id']}/returns", headers=h,
                        json={"lines": [{"item_id": returned["item"]["id"], "quantity": "10"}]})
    assert again.status_code == 201, again.text


def test_the_ledger_is_reversed_not_erased(client, returned, db):
    """قيد مضاد — الدفتر مابيتمحاش."""
    from src.models.ledger import LedgerEntry
    from src.models.purchasing import PurchaseReturn

    ret = db.get(PurchaseReturn, returned["return_id"])
    original = ret.ledger_entry_id
    assert original, "المردود اترحّل من غير قيد"

    res = client.post(f"/api/v1/purchases/returns/{returned['return_id']}/reverse",
                      headers=returned["h"])
    assert res.status_code == 200, res.text

    db.expire_all()
    ret = db.get(PurchaseReturn, returned["return_id"])
    assert ret.reversed_at is not None
    assert ret.reversal_entry_id, "مافيش قيد مضاد"
    counter = db.get(LedgerEntry, ret.reversal_entry_id)
    assert counter.reverses_entry_id == original
    # والأصلي لسه مكانه.
    assert db.get(LedgerEntry, original) is not None


def test_reversing_twice_is_refused(client, returned):
    h = returned["h"]
    assert client.post(f"/api/v1/purchases/returns/{returned['return_id']}/reverse",
                       headers=h).status_code == 200
    again = client.post(f"/api/v1/purchases/returns/{returned['return_id']}/reverse", headers=h)
    assert again.status_code == 409, again.text
    assert again.json()["detail"]["code"] == "reverse_invalid"


def test_a_return_that_does_not_exist_is_refused(client, returned):
    res = client.post("/api/v1/purchases/returns/99999/reverse", headers=returned["h"])
    assert res.status_code == 409, res.text


def test_only_somebody_who_may_write_returns_can_reverse_one(client, returned, login):
    # المحاسب بيقرا الدفاتر ومابيحركش بضاعة — `return.write` مش معاه.
    accountant = login("acct")
    res = client.post(f"/api/v1/purchases/returns/{returned['return_id']}/reverse",
                      headers=accountant)
    assert res.status_code == 403, res.text
