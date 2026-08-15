"""تحليل الربحية بمركز التكلفة وبالفرع (٨).

النظام كان بيعرف يقول «الشركة كسبت كام» وبس. The data behind «الفرع ده كسب كام» and «المشروع ده
كلّف كام» has been posted to the books for as long as cost centres have existed —
`LedgerLine.cost_center_id` and `LedgerEntry.branch_id` are written on every posting — and nothing
ever read them grouped.

الخواص اللي الملف ده بيدافع عنها:

* **بيتقرا من الدفتر مش من المستندات.** Re-summing invoices would produce a second set of figures
  that disagrees with the income statement the moment anything is posted by hand, and the person
  holding two numbers cannot tell which one is the company's.
* **اللي ماتوزّعش بيبان كسطر، مش كفرق.** A line with no cost centre goes into «غير موزّع» — a real
  bucket. Hiding it makes the parts silently not add up to the whole, and the reader has no way to
  see where the gap went.
* **مركز التكلفة على السطر والفرع على القيد.** One journal entry can split an expense across three
  cost centres and cannot be split across two branches. So a cost-centre report divides inside a
  document and a branch report never does.
"""
from __future__ import annotations

from decimal import Decimal

import pytest


@pytest.fixture()
def books(client, cost_centers, login):
    """قيود على مركزين، وواحد من غير مركز — وكلهم على فرع A."""
    h = login("admin")
    return {**cost_centers, "h": h}


def _post(client, s, *, date, description, lines, branch_id=None):
    res = client.post("/api/v1/journal-entries", headers=s["h"], json={
        "date": date, "branch_id": branch_id or s["branch_a"],
        "description": description, "lines": lines})
    assert res.status_code == 201, res.text
    return res.json()


def _revenue(s, amount, cost_center_id=None):
    return [
        {"account_id": s["treasury"], "direction": "debit", "amount": amount},
        {"account_id": s["sales_revenue"], "direction": "credit", "amount": amount,
         **({"cost_center_id": cost_center_id} if cost_center_id else {})},
    ]


def _expense(s, amount, cost_center_id=None):
    return [
        {"account_id": s["rent"], "direction": "debit", "amount": amount,
         **({"cost_center_id": cost_center_id} if cost_center_id else {})},
        {"account_id": s["treasury"], "direction": "credit", "amount": amount},
    ]


def _report(client, s, **params):
    return client.get("/api/v1/reports/profitability", headers=s["h"], params=params)


# ------------------------------------------------------------------ الشكل


def test_an_unknown_dimension_is_refused(client, books):
    res = _report(client, books, dimension="حاجة")
    assert res.status_code == 422, res.text
    assert res.json()["detail"]["code"] == "report_invalid"


def test_an_empty_book_answers_with_nothing_rather_than_failing(client, books):
    res = _report(client, books).json()
    assert res["rows"] == []
    assert Decimal(res["totals"]["profit"]) == Decimal("0.00")


# ------------------------------------------------------------------ مركز التكلفة


def test_each_cost_centre_gets_its_own_profit(client, books):
    _post(client, books, date="2026-03-01", description="إيراد نصر",
          lines=_revenue(books, "1000", books["cc_nasr"]))
    _post(client, books, date="2026-03-02", description="إيجار نصر",
          lines=_expense(books, "300", books["cc_nasr"]))
    _post(client, books, date="2026-03-03", description="إيراد المعادي",
          lines=_revenue(books, "500", books["cc_maadi"]))

    rows = {r["label"]: r for r in _report(client, books, dimension="cost_center").json()["rows"]}
    assert Decimal(rows["معرض مدينة نصر"]["income"]) == Decimal("1000.00")
    assert Decimal(rows["معرض مدينة نصر"]["expenses"]) == Decimal("300.00")
    assert Decimal(rows["معرض مدينة نصر"]["profit"]) == Decimal("700.00")
    assert Decimal(rows["معرض المعادي"]["profit"]) == Decimal("500.00")


def test_a_balance_sheet_movement_is_not_profit(client, books):
    """الربحية إيرادات ومصروفات وبس — حركة أصل مش دي ولا دي.

    Cost centres get written onto whatever line the person posting felt they belonged to, and
    nothing stops that being a treasury or a receivable line. Counted here, moving money between
    two accounts would read as an expense the centre never incurred — a loss invented by a
    bookkeeping entry that changed nothing.
    """
    _post(client, books, date="2026-03-21", description="حركة أصل بمركز", lines=[
        {"account_id": books["treasury"], "direction": "debit", "amount": "900",
         "cost_center_id": books["cc_nasr"]},
        {"account_id": books["opening_equity"], "direction": "credit", "amount": "900"},
    ])
    rows = {r["label"]: r for r in _report(client, books, dimension="cost_center").json()["rows"]}
    assert "معرض مدينة نصر" not in rows, "حركة الأصل اتحسبت في ربحية المركز"
    assert Decimal(_report(client, books).json()["totals"]["profit"]) == Decimal("0.00")


def test_one_entry_can_split_across_two_cost_centres(client, books):
    """مركز التكلفة على **السطر** — قيد واحد بيتقسّم، والتقرير لازم يشوف القسمة."""
    _post(client, books, date="2026-03-04", description="إيجار مقسوم", lines=[
        {"account_id": books["rent"], "direction": "debit", "amount": "600",
         "cost_center_id": books["cc_nasr"]},
        {"account_id": books["rent"], "direction": "debit", "amount": "400",
         "cost_center_id": books["cc_maadi"]},
        {"account_id": books["treasury"], "direction": "credit", "amount": "1000"},
    ])
    rows = {r["label"]: r for r in _report(client, books, dimension="cost_center").json()["rows"]}
    assert Decimal(rows["معرض مدينة نصر"]["expenses"]) == Decimal("600.00")
    assert Decimal(rows["معرض المعادي"]["expenses"]) == Decimal("400.00")


def test_what_was_not_assigned_shows_as_its_own_row(client, books):
    """«غير موزّع» دلو حقيقي — إخفاؤه بيخلّي الأجزاء ماتجمعش الكل والقارئ مايعرفش ليه."""
    _post(client, books, date="2026-03-05", description="إيراد بمركز",
          lines=_revenue(books, "800", books["cc_nasr"]))
    _post(client, books, date="2026-03-06", description="إيراد من غير مركز",
          lines=_revenue(books, "200"))

    res = _report(client, books, dimension="cost_center").json()
    unassigned = [r for r in res["rows"] if r["unassigned"]]
    assert len(unassigned) == 1, "اللي ماتوزّعش اختفى"
    assert Decimal(unassigned[0]["income"]) == Decimal("200.00")
    assert res["totals"]["unassigned_lines"] == 1
    # والمجموع بيساوي قايمة الدخل — الأجزاء بتجمع الكل.
    assert Decimal(res["totals"]["income"]) == Decimal("1000.00")


def test_dropping_the_unassigned_is_a_choice_the_totals_follow(client, books):
    _post(client, books, date="2026-03-07", description="بمركز",
          lines=_revenue(books, "800", books["cc_nasr"]))
    _post(client, books, date="2026-03-08", description="من غير مركز",
          lines=_revenue(books, "200"))

    without = _report(client, books, dimension="cost_center",
                      include_unassigned=False).json()
    assert [r for r in without["rows"] if r["unassigned"]] == []
    assert Decimal(without["totals"]["income"]) == Decimal("800.00")


# ------------------------------------------------------------------ الفروع


def test_the_branches_are_compared_from_the_same_books(client, books):
    _post(client, books, date="2026-03-09", description="بيع فرع أ",
          lines=_revenue(books, "1000"), branch_id=books["branch_a"])
    _post(client, books, date="2026-03-10", description="إيجار فرع أ",
          lines=_expense(books, "250"), branch_id=books["branch_a"])
    _post(client, books, date="2026-03-11", description="بيع فرع ب",
          lines=_revenue(books, "400"), branch_id=books["branch_b"])

    rows = {r["label"]: r for r in _report(client, books, dimension="branch").json()["rows"]}
    assert Decimal(rows["Branch A"]["profit"]) == Decimal("750.00")
    assert Decimal(rows["Branch B"]["profit"]) == Decimal("400.00")


def test_the_best_branch_is_first(client, books):
    """الترتيب هو نص الإجابة على «مقارنة الفروع»."""
    _post(client, books, date="2026-03-12", description="فرع أ",
          lines=_revenue(books, "100"), branch_id=books["branch_a"])
    _post(client, books, date="2026-03-13", description="فرع ب",
          lines=_revenue(books, "900"), branch_id=books["branch_b"])
    rows = _report(client, books, dimension="branch").json()["rows"]
    assert rows[0]["label"] == "Branch B"


# ------------------------------------------------------------------ الفترة والعكس


def test_the_period_filter_uses_the_entry_date(client, books):
    _post(client, books, date="2026-01-15", description="يناير",
          lines=_revenue(books, "100", books["cc_nasr"]))
    _post(client, books, date="2026-03-15", description="مارس",
          lines=_revenue(books, "700", books["cc_nasr"]))

    march = _report(client, books, dimension="cost_center",
                    date_from="2026-03-01", date_to="2026-03-31").json()
    assert Decimal(march["totals"]["income"]) == Decimal("700.00")


def test_a_reversal_cancels_the_entry_it_reverses(client, books):
    """القيد المرحّل مابيتعدّلش — التصحيح عكس، والعكس والأصل بيلغوا بعض في الربح.

    Nothing in the report handles this specially, and that is the point: both entries are in the
    books and they net to zero on their own. A report that filtered reversals out by hand would
    have to be right about which ones, forever.
    """
    entry = _post(client, books, date="2026-03-16", description="إيراد غلط",
                  lines=_revenue(books, "500", books["cc_nasr"]))
    res = client.post(f"/api/v1/journal-entries/{entry['id']}/reverse", headers=books["h"],
                      json={"date": "2026-03-17", "reason": "تصحيح"})
    assert res.status_code in (200, 201), res.text

    report = _report(client, books, dimension="cost_center").json()
    assert Decimal(report["totals"]["income"]) == Decimal("0.00")


# ------------------------------------------------------------------ التفصيل


def test_the_breakdown_says_where_the_number_came_from(client, books):
    """أول سؤال بعد «المركز ده خسر ٢٠ ألف» هو «في إيه»."""
    _post(client, books, date="2026-03-18", description="إيراد",
          lines=_revenue(books, "1000", books["cc_nasr"]))
    _post(client, books, date="2026-03-19", description="إيجار",
          lines=_expense(books, "300", books["cc_nasr"]))

    res = client.get("/api/v1/reports/profitability/breakdown", headers=books["h"],
                     params={"dimension": "cost_center", "key": books["cc_nasr"]})
    assert res.status_code == 200, res.text
    body = res.json()
    natures = {r["nature"] for r in body["rows"]}
    assert natures == {"income", "expense"}
    assert Decimal(body["totals"]["profit"]) == Decimal("700.00")


def test_the_breakdown_of_the_unassigned_is_reachable(client, books):
    """«غير موزّع» سطر في التقرير، فلازم يتفتح زيه زي أي سطر."""
    _post(client, books, date="2026-03-20", description="من غير مركز",
          lines=_revenue(books, "250"))
    res = client.get("/api/v1/reports/profitability/breakdown", headers=books["h"],
                     params={"dimension": "cost_center"}).json()
    assert Decimal(res["totals"]["income"]) == Decimal("250.00")


# ------------------------------------------------------------------ الصلاحيات


def test_only_somebody_who_can_read_the_books_can_read_the_profit(client, books, login):
    """الأرقام دي هي قايمة الدخل مقسومة — نفس الحد بتاع ميزان المراجعة."""
    rep = login("rep_a")
    assert client.get("/api/v1/reports/profitability", headers=rep).status_code == 403
    assert client.get("/api/v1/reports/profitability/breakdown",
                      headers=rep).status_code == 403
    assert client.get("/api/v1/reports/profitability", headers=login("acct")).status_code == 200
