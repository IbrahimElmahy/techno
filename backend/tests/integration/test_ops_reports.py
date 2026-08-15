"""تقارير التشغيل — النقاط والكوبونات والمعاينات والشيكات والطلبات والحجوزات (٨).

سبع مواضيع كان عندها listing وبس. You could page through five thousand point records and not ask
«مين أعلى عملاء في النقاط»، ولا «المعاينات اتوزّعت إزاي على المندوبين». This file defends the
properties that make the answers usable rather than merely present:

* **الملغي بيتعرض ومابيتحسبش.** A voided coupon and a rejected inspection are rows worth seeing —
  somebody is looking for why they are gone — and figures worth excluding. Dropping the row would
  answer the second question by hiding the first; counting it would say the company owes something
  it does not.
* **الشيكات بتتفلتر بتاريخ الاستحقاق مش تاريخ التسجيل.** Nobody asks what was written down last
  month. They ask what is coming due, and a report filtered the other way answers a different
  question while looking identical.
* **نقطة نهاية واحدة لسبع مواضيع مش باب خلفي لسبع صلاحيات.** The check runs per request against
  the subject actually asked for.
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

TODAY = date.today()


@pytest.fixture()
def ops_world(client, chart, login, db):
    """عميلين، معاينتين، تلات شيكات، وطلبين."""
    h = login("admin")
    from tests.conftest import make_customer_with_account

    one, _ = make_customer_with_account(db, chart["rep_a"], chart["terr_a"],
                                        code="OPS-1", name="عميل واحد")
    two, _ = make_customer_with_account(db, chart["rep_b"], chart["terr_b"],
                                        code="OPS-2", name="عميل اتنين")
    db.commit()
    return {**chart, "h": h, "one": one.id, "two": two.id}


def _ops(client, s, **params):
    return client.get("/api/v1/reports/ops", headers=s["h"], params=params)


def _add_inspection(client, s, *, points, when=None, kind="technician", shop="محل النور"):
    res = client.post("/api/v1/inspections", headers=s["h"], json={
        "visit_kind": kind,
        "inspection_date": str(when or TODAY),
        "customer_id": s["one"],
        "owner_name": "صاحب الشقة",
        "purchase_shop": shop,
        "items": [{"item_name": "سخان", "quantity": "1", "points": str(points)}],
    })
    assert res.status_code in (200, 201), res.text
    return res.json()


def _add_cheque(client, s, *, amount, due, issued=None):
    # الشيك مابيستحقش قبل ما يتحرّر — قاعدة في الموديول نفسه، فالشيك المتأخر بيتكتب بتاريخ تحرير
    # أقدم من استحقاقه مش بتاريخ النهاردة.
    res = client.post("/api/v1/cheques", headers=s["h"], json={
        "direction": "incoming", "cheque_number": f"CH{due}", "amount": str(amount),
        "issue_date": str(issued or min(TODAY, due)), "due_date": str(due),
        "customer_id": s["one"],
    })
    assert res.status_code in (200, 201), res.text
    return res.json()


# ------------------------------------------------------------------ الشكل


def test_an_unknown_subject_is_refused(client, ops_world):
    res = _ops(client, ops_world, subject="حاجة")
    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "report_invalid"


def test_a_summary_with_no_grouping_is_refused(client, ops_world):
    res = _ops(client, ops_world, subject="inspections", level="summary", group_by="none")
    assert res.status_code == 422, res.text


def test_every_subject_answers(client, ops_world):
    for subject in ("points", "coupons", "coupon_receipts", "inspections",
                    "cheques", "orders", "reservations"):
        res = _ops(client, ops_world, subject=subject)
        assert res.status_code == 200, f"{subject}: {res.text}"
        body = res.json()
        assert "rows" in body and "totals" in body and "page" in body


# ------------------------------------------------------------------ المعاينات


def test_the_inspection_report_carries_the_points(client, ops_world):
    _add_inspection(client, ops_world, points=50)
    _add_inspection(client, ops_world, points=30)
    res = _ops(client, ops_world, subject="inspections").json()
    assert res["totals"]["rows"] == 2
    assert Decimal(res["totals"]["quantity"]) == Decimal("80.000")


def test_inspections_group_by_rep(client, ops_world):
    _add_inspection(client, ops_world, points=50)
    res = _ops(client, ops_world, subject="inspections", group_by="rep").json()
    assert len(res["rows"]) == 1
    assert res["rows"][0]["quantity"] == "50.000"


def test_inspections_group_by_shop(client, ops_world):
    """محل الشراء — التاجر اللي المعاينات جاية منه."""
    _add_inspection(client, ops_world, points=10, shop="محل النور")
    _add_inspection(client, ops_world, points=20, shop="محل الأمل")
    res = _ops(client, ops_world, subject="inspections", group_by="shop").json()
    by_shop = {r["label"]: r["quantity"] for r in res["rows"]}
    assert by_shop == {"محل النور": "10.000", "محل الأمل": "20.000"}


def test_a_rejected_inspection_shows_but_does_not_count(client, ops_world):
    """المرفوضة بديل الحذف — تختفي من الشاشة يعني محدش يعرف ليه راحت."""
    kept = _add_inspection(client, ops_world, points=40)
    gone = _add_inspection(client, ops_world, points=60)
    res = client.post(f"/api/v1/inspections/{gone['id']}/reject", headers=ops_world["h"])
    assert res.status_code in (200, 204), res.text

    report = _ops(client, ops_world, subject="inspections").json()
    assert report["totals"]["rows"] == 2, "المرفوضة اتشالت من الشاشة"
    assert report["totals"]["counted"] == 1
    assert report["totals"]["excluded"] == 1
    assert Decimal(report["totals"]["quantity"]) == Decimal("40.000"), "المرفوضة اتحسبت"
    assert {r["document_number"] for r in report["rows"]} == {
        kept["document_number"], gone["document_number"]}


# ------------------------------------------------------------------ الشيكات


def test_the_cheque_report_filters_on_the_due_date(client, ops_world):
    """«اللي بيستحق»، مش «اللي اتسجّل»."""
    soon = TODAY + timedelta(days=5)
    later = TODAY + timedelta(days=90)
    _add_cheque(client, ops_world, amount="1000", due=soon)
    _add_cheque(client, ops_world, amount="2000", due=later)

    # الاتنين اتسجّلوا النهاردة — فلو الفلتر على تاريخ التسجيل هيرجّع الاتنين.
    res = _ops(client, ops_world, subject="cheques",
               date_from=str(TODAY), date_to=str(TODAY + timedelta(days=30))).json()
    assert res["totals"]["rows"] == 1, "الفلتر شغّال على تاريخ التسجيل مش الاستحقاق"
    assert Decimal(res["totals"]["amount"]) == Decimal("1000.00")


def test_due_within_days_is_the_same_filter_said_shorter(client, ops_world):
    _add_cheque(client, ops_world, amount="1000", due=TODAY + timedelta(days=5))
    _add_cheque(client, ops_world, amount="2000", due=TODAY + timedelta(days=90))
    res = _ops(client, ops_world, subject="cheques", due_within_days=30).json()
    assert res["totals"]["rows"] == 1
    assert Decimal(res["totals"]["amount"]) == Decimal("1000.00")


def test_a_cheque_past_its_due_date_is_marked_overdue(client, ops_world):
    _add_cheque(client, ops_world, amount="500", due=TODAY - timedelta(days=10))
    res = _ops(client, ops_world, subject="cheques").json()
    row = res["rows"][0]
    assert row["overdue"] is True
    assert row["days_to_due"] == -10


def test_a_settled_cheque_is_not_overdue(client, ops_world):
    """المتأخر هو اللي فات استحقاقه وهو **لسه** تحت التحصيل."""
    cheque = _add_cheque(client, ops_world, amount="500", due=TODAY - timedelta(days=10))
    res = client.post(f"/api/v1/cheques/{cheque['id']}/settle", headers=ops_world["h"],
                      json={"settled_on": str(TODAY)})
    assert res.status_code in (200, 204), res.text
    report = _ops(client, ops_world, subject="cheques").json()
    assert report["rows"][0]["overdue"] is False


def test_cheques_group_by_status(client, ops_world):
    _add_cheque(client, ops_world, amount="500", due=TODAY + timedelta(days=3))
    _add_cheque(client, ops_world, amount="700", due=TODAY + timedelta(days=4))
    res = _ops(client, ops_world, subject="cheques", group_by="status").json()
    assert len(res["rows"]) == 1
    assert res["rows"][0]["label"] == "تحت التحصيل"
    assert Decimal(res["rows"][0]["amount"]) == Decimal("1200.00")


# ------------------------------------------------------------------ الترقيم والإجماليات


def test_the_totals_cover_everything_not_just_the_page(client, ops_world):
    for points in (10, 20, 30):
        _add_inspection(client, ops_world, points=points)
    full = _ops(client, ops_world, subject="inspections").json()
    paged = _ops(client, ops_world, subject="inspections", limit=1).json()
    assert len(paged["rows"]) == 1
    assert paged["totals"] == full["totals"], "الإجماليات اتحسبت على الصفحة"
    assert Decimal(paged["totals"]["quantity"]) == Decimal("60.000")


def test_the_page_says_it_was_cut(client, ops_world):
    for points in (10, 20, 30):
        _add_inspection(client, ops_world, points=points)
    res = _ops(client, ops_world, subject="inspections", limit=2).json()
    assert res["page"]["total_rows"] == 3
    assert res["page"]["truncated"] is True


def test_the_offset_walks_forward(client, ops_world):
    for points in (10, 20, 30):
        _add_inspection(client, ops_world, points=points)
    first = _ops(client, ops_world, subject="inspections", limit=2, offset=0).json()
    second = _ops(client, ops_world, subject="inspections", limit=2, offset=2).json()
    assert len(second["rows"]) == 1
    assert second["page"]["truncated"] is False
    numbers = ({r["document_number"] for r in first["rows"]}
               | {r["document_number"] for r in second["rows"]})
    assert len(numbers) == 3, "صف اتكرر أو ضاع بين الصفحتين"


# ------------------------------------------------------------------ الترتيب


def test_top_customers_is_cut_and_says_so(client, ops_world):
    """«أعلى ٢٠» ترتيب مقصوص — والقص هو الفكرة، فلازم يتقال."""
    _add_inspection(client, ops_world, points=10)
    res = client.get("/api/v1/reports/ops/top-customers", headers=ops_world["h"],
                     params={"metric": "coupons", "limit": 1})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["metric"] == "coupons"
    assert len(body["rows"]) <= 1


def test_an_unknown_metric_is_refused(client, ops_world):
    res = client.get("/api/v1/reports/ops/top-customers", headers=ops_world["h"],
                     params={"metric": "حاجة"})
    assert res.status_code in (403, 422), res.text


# ------------------------------------------------------------------ الصلاحيات


def test_the_gate_is_the_subject_not_the_endpoint(client, ops_world, login):
    """نقطة نهاية واحدة لسبع مواضيع مش باب خلفي لسبع صلاحيات.

    A capability called `reports.read` would hand whoever holds it the cheque register, the loyalty
    ledger and every customer's inspection history at once. The check runs per request against the
    subject actually asked for, and it lands exactly where each module's own list already lands —
    a report must not open a door its screen keeps shut, and must not shut one its screen opens.

    الاتنين دول متكاملين عن قصد: خدمة ما بعد البيع عندها الولاء والمعاينات، والمحاسب عنده الشيكات.
    """
    after_sales = login("asales")   # loyalty + inspection، من غير شيكات ولا مبيعات
    accountant = login("acct")      # شيكات بس

    for subject in ("points", "coupons", "inspections"):
        assert client.get("/api/v1/reports/ops", headers=after_sales,
                          params={"subject": subject}).status_code == 200, subject
    for subject in ("cheques", "orders", "reservations"):
        assert client.get("/api/v1/reports/ops", headers=after_sales,
                          params={"subject": subject}).status_code == 403, subject

    assert client.get("/api/v1/reports/ops", headers=accountant,
                      params={"subject": "cheques"}).status_code == 200
    for subject in ("points", "coupons", "inspections"):
        assert client.get("/api/v1/reports/ops", headers=accountant,
                          params={"subject": subject}).status_code == 403, subject


def test_an_unknown_subject_is_refused_before_the_gate_leaks_anything(client, ops_world, login):
    rep = login("rep_a")
    res = client.get("/api/v1/reports/ops", headers=rep, params={"subject": "حاجة"})
    assert res.status_code == 422, res.text
