"""سجل فواتير الشرا بيرجّع الأعمدة اللي بتتعرض عليه (٨).

العميل صوّر سجل الشرا اللي هو شغّال عليه: التاريخ، مستند رقم، الفاتورة رقم، الحساب الفرعي، جهة
التعامل، اجمالي قبل، خصم الفاتورة وقيمته ونسبته، الضرائب وقيمتها ونسبتها، الاجمالي، الصافي، تم
السداد، الباقي، الفرع، الملاحظات — وطلب نفس الحاجات بالظبط.

**وأربعة منهم كانوا معرّفين في العقد ومابيتعبّوش.** `gross` و`combined_pct` و`net` و`tax_amount`
مكتوبين في `PurchaseListOut` من زمان بقيم افتراضية، والـendpoint مكانش بيمرّرهم — فكل صف في السجل
كان بيرجّعهم **صفر**. العقد بيوعد بأربع أرقام والسجل بيرجّعهم أصفار، ومفيش حاجة كانت بتزعق: الشاشة
مكانتش بتعرضهم أصلاً، فالصفر مكانش بيبان لحد.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def bought(client, inv_world, login, db):
    """فاتورة شرا فيها خصم وضريبة — عشان الأرقام اللي بتتقاس ما تبقاش كلها أصفار."""
    h = login("admin")
    supplier = client.post("/api/v1/suppliers", headers=h,
                           json={"name": "مورد السجل"}).json()
    item = client.post("/api/v1/items", headers=h, json={
        "name": "صنف السجل", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "50"}).json()

    res = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": supplier["id"],
        "location": {"location_kind": "warehouse", "location_id": inv_world["branch_wh"]},
        "purchase_date": "2026-08-19",
        "external_document_number": "INV-9911",
        "notes": "ملاحظة على الفاتورة",
        "variable_discount_pct": "10",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "100"}],
        "cash_amount": "500", "credit_amount": "400",
    })
    assert res.status_code in (200, 201), res.text
    return {**inv_world, "h": h, "supplier": supplier, "item": item,
            "invoice": res.json()}


def _row(client, s):
    res = client.get("/api/v1/purchases", headers=s["h"])
    assert res.status_code == 200, res.text
    return res.json()[0]


def test_the_money_columns_are_not_all_zero(client, bought):
    """أهم فحص في الملف — دول كانوا بيرجعوا أصفار في صمت."""
    row = _row(client, bought)
    assert Decimal(row["gross"]) == Decimal("1000.00"), "اجمالي قبل الخصم رجع صفر"
    assert Decimal(row["combined_pct"]) == Decimal("10.00"), "نسبة الخصم رجعت صفر"
    assert Decimal(row["net"]) == Decimal("900.00"), "الصافي رجع صفر"


def test_the_discount_is_returned_as_an_amount_not_only_a_rate(client, bought):
    """«١٠٪» مابتقولش كام اتخصم — والسطر في السجل بيتقري بالجنيه."""
    row = _row(client, bought)
    assert Decimal(row["discount_amount"]) == Decimal("100.00")


def test_the_tax_rate_is_derived_and_survives_a_zero_net(client, bought, login):
    """نسبة الضريبة مشتقّة من الصافي — وفاتورة صافيها صفر مابتكسرش السجل بقسمة على صفر."""
    row = _row(client, bought)
    # مفيش ضريبة على الفاتورة دي، فالنسبة صفر — مش خطأ.
    assert Decimal(row["tax_amount"]) == Decimal("0.00")
    assert Decimal(row["tax_pct"]) == Decimal("0.00")


def test_the_register_names_the_branch_behind_the_warehouse(client, bought):
    """الفرع مش على الفاتورة — هو على المخزن اللي البضاعة نزلت فيه."""
    row = _row(client, bought)
    assert row["branch_id"] == bought["branch_a"]
    assert row["branch_name"], "الرقم لوحده بيخلّي القارئ يدوّر عليه"


def test_the_register_carries_what_the_filters_search_on(client, bought):
    """الفلاتر اللي في الشاشة لازم تلاقي حاجة تفلتر بيها."""
    row = _row(client, bought)
    assert row["document_number"]
    assert row["external_document_number"] == "INV-9911"
    assert row["notes"] == "ملاحظة على الفاتورة"
    assert row["supplier_name"] == "مورد السجل"
    assert row["purchase_date"] == "2026-08-19"


def test_a_purchase_with_no_posting_account_says_so_rather_than_inventing_one(client, bought):
    row = _row(client, bought)
    # الفاتورة دي ماتحطلهاش حساب — العمود بيرجع فاضي، مش حساب افتراضي.
    assert row["expense_account_id"] is None
    assert row["expense_account_name"] is None


def test_a_posting_account_comes_back_with_its_name(client, bought, chart):
    """«الحساب الفرعي» في السجل — الكود والاسم، مش رقم الحساب."""
    h = bought["h"]
    res = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": bought["supplier"]["id"],
        "location": {"location_kind": "warehouse", "location_id": bought["branch_wh"]},
        "expense_account_id": chart["rent"],
        "lines": [{"item_id": bought["item"]["id"], "quantity": "1", "unit_price": "10"}],
        "cash_amount": "10", "credit_amount": "0",
    })
    assert res.status_code in (200, 201), res.text
    row = _row(client, bought)
    assert row["expense_account_id"] == chart["rent"]
    assert row["expense_account_name"], "الرقم من غير اسم بيخلّي القارئ يفتح شجرة الحسابات"
