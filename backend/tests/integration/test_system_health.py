"""فحص النظام — الصفحة الرئيسية بتقول فيه إيه غلط.

Every problem the health check reports was already discoverable on some screen. What was missing
is anybody looking: an item priced at nothing keeps being sold at nothing, a warehouse holding a
negative balance stays negative, an invoice line with no captured cost keeps reporting its whole
price as profit.

A check that cannot fire is worse than no check, because an empty page then reads as a clean
system. So each test here MAKES the fault and demands the check find it — none of them assert only
that the endpoint answered.
"""
from __future__ import annotations

from decimal import Decimal


def _health(client, h):
    res = client.get("/api/v1/reports/health", headers=h)
    assert res.status_code == 200, res.text
    return res.json()


def _issue(body, key):
    return next((i for i in body["issues"] if i["key"] == key), None)


def test_a_clean_system_says_so(client, inv_world, login):
    """The empty answer has to be an answer.

    If «clean» were merely an empty list, a broken endpoint and a healthy system would render the
    same page — and the page most people see most days is the healthy one.
    """
    body = _health(client, login("admin"))
    assert "clean" in body and "issues" in body and "totals" in body
    assert body["clean"] is (len(body["issues"]) == 0)


def test_every_finding_says_what_to_do_and_where_to_go(client, inv_world, login, db):
    """A count with nowhere to click is a complaint, not a finding."""
    from src.models.catalog import Item, ItemKind

    db.add(Item(code="NOPRICE-1", name="صنف من غير سعر", kind=ItemKind.product,
                unit_of_measure="pc", active=True))
    db.commit()

    body = _health(client, login("admin"))
    assert body["issues"], "المفروض لقى حاجة على الأقل"
    for issue in body["issues"]:
        assert issue["title"], issue
        assert issue["hint"], f"«{issue['title']}» بيقول فيه مشكلة ومش بيقول هي مكلفاك إيه"
        assert issue["link"].startswith("/"), f"«{issue['title']}» مالهاش صفحة تروحلها"
        assert issue["count"] >= 1
        assert issue["severity"] in ("high", "medium", "low")


def test_it_finds_a_product_with_no_price_anywhere(client, inv_world, login, db):
    """Not a blank field: this is the number the invoice line reaches for."""
    from src.models.catalog import Item, ItemKind

    db.add(Item(code="NOPRICE-2", name="منتج بلا سعر", kind=ItemKind.product,
                unit_of_measure="pc", active=True))
    db.commit()

    issue = _issue(_health(client, login("admin")), "item_no_price")
    assert issue is not None, "منتج من غير سعر خالص ومحدش قال"
    assert any("NOPRICE-2" in s["label"] for s in issue["samples"])


def test_a_tiered_price_is_still_a_price(client, inv_world, login, db):
    """The check asks whether the item can be priced AT ALL, not whether one column is filled.

    An item priced per tier (007) but with no `sale_price` is fully priced. Flagging it would put
    most of a real catalogue on the page and teach everyone to ignore it.
    """
    from src.models.catalog import Item, ItemKind, ItemPrice, PriceTier

    item = Item(code="TIERED-1", name="متسعّر بالشرايح", kind=ItemKind.product,
                unit_of_measure="pc", active=True)   # sale_price left NULL on purpose
    db.add(item)
    db.flush()
    db.add(ItemPrice(item_id=item.id, tier=PriceTier.wholesale, price=Decimal("50")))
    db.commit()

    issue = _issue(_health(client, login("admin")), "item_no_price")
    labels = [s["label"] for s in (issue["samples"] if issue else [])]
    assert not any("TIERED-1" in ln for ln in labels), "الصنف متسعّر بشريحة، مش ناقص سعر"


def test_it_finds_a_min_above_a_max(client, inv_world, login, db):
    """Both limits set and contradicting each other: the item is below its floor and above its
    ceiling at once, and the reorder report says both."""
    from src.models.catalog import Item, ItemKind

    db.add(Item(code="MINMAX-1", name="حدود متعاكسة", kind=ItemKind.product,
                unit_of_measure="pc", active=True,
                min_stock=Decimal("100"), max_stock=Decimal("10")))
    db.commit()

    issue = _issue(_health(client, login("admin")), "min_over_max")
    assert issue is not None
    assert any("MINMAX-1" in s["label"] for s in issue["samples"])


def test_it_finds_an_invoice_line_with_no_captured_cost(client, inv_world, login, db):
    """Cost is frozen on the line when the invoice is written (030) so past profit never moves.

    NULL there does not read as «unknown» downstream — it reads as zero, so the line reports its
    entire price as profit, and the margin of the invoice, the customer, the item and the month are
    all overstated together. Legacy rows written before 030 are exactly this shape, which is why
    the check exists rather than a NOT NULL constraint.
    """
    from src.models.sales import SalesInvoice, SalesInvoiceLine

    h = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=h, json={
        "name": "بضاعة بتكلفة", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مورد التكلفة"}).json()
    client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "200", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "5", "unit_price": "40"}]})
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل التكلفة", "customer_type": "trader",
        "rep_id": inv_world["rep_a"], "territory_id": inv_world["terr_a"]}).json()
    sale = client.post("/api/v1/sales", headers=h, json={
        "customer_id": cust["id"],
        "origin": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "100", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "1", "unit_price": "100"}]})
    assert sale.status_code == 201, sale.text
    number = sale.json()["document_number"]

    # A healthy invoice is not a finding — the check has to distinguish them.
    assert _issue(_health(client, h), "invoice_no_cost") is None

    # Now the legacy shape: the cost was never captured.
    line = db.query(SalesInvoiceLine).join(SalesInvoice).filter(
        SalesInvoice.document_number == number).first()
    line.unit_cost = None
    db.commit()

    issue = _issue(_health(client, h), "invoice_no_cost")
    assert issue is not None, "فاتورة بندها من غير تكلفة ومحدش قال"
    assert issue["severity"] == "high", "ربح غلط مش تنبيه، ده رقم بايظ"
    assert any(number in s["label"] for s in issue["samples"])


def test_the_worst_comes_first(client, inv_world, login, db):
    """A wrong number outranks a missing one. Sorting by count would put four hundred uncategorised
    items above one unbalanced ledger entry."""
    from src.models.catalog import Item, ItemKind

    # Many low-severity findings…
    for n in range(6):
        db.add(Item(code=f"NOCAT-{n}", name=f"بلا فئة {n}", kind=ItemKind.product,
                    unit_of_measure="pc", active=True, sale_price=Decimal("10")))
    db.commit()

    body = _health(client, login("admin"))
    ranks = {"high": 0, "medium": 1, "low": 2}
    order = [ranks[i["severity"]] for i in body["issues"]]
    assert order == sorted(order), "الترتيب مش بالأخطر الأول"


def test_it_does_not_write_anything(client, inv_world, login, db):
    """A diagnosis that changes the patient is not a diagnosis — and this runs unattended on every
    dashboard load."""
    from sqlalchemy import func, select

    from src.models.catalog import Item
    from src.models.ledger import LedgerEntry
    from src.models.sales import SalesInvoice

    def counts():
        return tuple(db.scalar(select(func.count()).select_from(m))
                     for m in (Item, LedgerEntry, SalesInvoice))

    before = counts()
    _health(client, login("admin"))
    db.expire_all()
    assert counts() == before


def test_it_answers_in_one_call(client, inv_world, login):
    """Eleven checks, one request.

    The dashboard asking one endpoint per check would be eleven round trips to draw one page, and
    would leave the page half-answered whenever one of them failed.
    """
    body = _health(client, login("admin"))
    groups = {i["group"] for i in body["issues"]}
    assert groups <= {"المنتجات", "رصيد المنتجات", "فواتير العملاء", "الحسابات"}


# ---------------------------------------------------------------------------
# مواعيد عدّت وقاعدة (٨)
# ---------------------------------------------------------------------------
#
# التلاتة دول ليهم تقارير، والتقرير بيتفتح لما حد يفتحه. Each is a deadline the company itself set
# and the data has quietly passed — which is exactly the kind of thing this page exists to say
# without being asked.


def test_it_finds_a_cheque_whose_due_date_went_by(client, inv_world, login, db):
    """شيك فات استحقاقه وهو لسه تحت التحصيل — يا اتحصّل وماتسجّلش، يا محدش بيجري وراه."""
    from datetime import date, timedelta

    from src.models.cheque import Cheque, ChequeDirection, ChequeStatus

    due = date.today() - timedelta(days=12)
    db.add(Cheque(document_number="CHQ-H1", direction=ChequeDirection.incoming,
                  status=ChequeStatus.pending, cheque_number="998877",
                  amount=Decimal("4500.00"), issue_date=due - timedelta(days=30),
                  due_date=due, actor_user_id=inv_world["admin"]))
    db.commit()

    found = _issue(_health(client, login("admin")), "overdue_cheques")
    assert found, "شيك فات استحقاقه عدّى من غير ما حد يقول"
    assert found["count"] == 1
    assert found["severity"] == "high"
    assert "4,500.00" in found["hint"], "بيقول فيه شيك ومش بيقول بكام"


def test_a_settled_cheque_is_not_an_overdue_one(client, inv_world, login, db):
    """المتأخر هو اللي فات استحقاقه وهو **لسه** تحت التحصيل."""
    from datetime import date, timedelta

    from src.models.cheque import Cheque, ChequeDirection, ChequeStatus

    due = date.today() - timedelta(days=12)
    db.add(Cheque(document_number="CHQ-H2", direction=ChequeDirection.incoming,
                  status=ChequeStatus.settled, cheque_number="112233",
                  amount=Decimal("900.00"), issue_date=due - timedelta(days=30),
                  due_date=due, settled_on=date.today(),
                  actor_user_id=inv_world["admin"]))
    db.commit()

    assert _issue(_health(client, login("admin")), "overdue_cheques") is None


def test_it_finds_a_hold_that_expired_while_still_holding(client, inv_world, login, db):
    """الكمية المحجوزة بتتخصم من المتاح — فحجز منتهي بضاعة مش بتتباع لحد."""
    from datetime import date, timedelta

    from src.models.catalog import Item, ItemKind
    from src.models.reservation import Reservation, ReservationStatus
    from src.models.stock import LocationKind

    from tests.conftest import make_customer_with_account

    item = Item(code="RES-H1", name="صنف محجوز", kind=ItemKind.product,
                unit_of_measure="pc", active=True)
    db.add(item)
    db.flush()
    holder, _ = make_customer_with_account(db, inv_world["rep_a"], inv_world["terr_a"],
                                           code="RES-CUST", name="عميل حاجز")
    db.add(Reservation(
        document_number="RSV-H1", customer_id=holder.id, item_id=item.id,
        location_kind=LocationKind.warehouse, location_id=inv_world["central_wh"],
        quantity=Decimal("5.000"), expires_on=date.today() - timedelta(days=3),
        status=ReservationStatus.active, actor_user_id=inv_world["admin"]))
    db.commit()

    found = _issue(_health(client, login("admin")), "expired_reservations")
    assert found, "حجز منتهي فاضل ماسك بضاعة"
    assert found["count"] == 1
    assert found["link"].startswith("/ops-reports")
