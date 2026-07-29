"""الحسابات الرئيسية (يظهر في · المستوى الرئيسي) + الربط بين كشف الحساب والمستند.

Two things read off their الحسابات الرئيسية screen and one thing they do not have:

* **«يظهر في» has three values, not two.** Egyptian practice splits the income statement into
  المتاجرة (down to gross profit) and أرباح وخسائر (down to net profit). My first pass collapsed
  both into one "income_statement", which loses the gross-profit line — the first number a trader
  reads. The three are asserted here so the split cannot be quietly merged again.
* **المستوى الرئيسي** — the standard grouping an account rolls up into.

The linking tests cover the other half of the request: a statement line used to be a dead row, so
answering «إيه السطر ده؟» meant memorising a number and going hunting. Now the line names its
document, and a hand-written journal entry says so rather than pointing at nothing.
"""
import pytest


def _account(client, chart, h, **extra):
    parent = chart["expense_group"]
    body = {"code": "5.10.901", "name": "حساب باركة", "nature": "expense",
            "is_postable": True, "parent_id": parent}
    body.update(extra)
    return client.post("/api/v1/accounts", headers=h, json=body)


def test_appears_in_accepts_the_three_real_statements(client, chart, login):
    admin = login("admin")
    for i, value in enumerate(["trading", "profit_loss", "balance_sheet"]):
        resp = _account(client, chart, admin, code=f"5.10.91{i}", name=f"حساب {value}",
                        appears_in=value)
        assert resp.status_code == 201, resp.text
        assert resp.json()["appears_in"] == value


def test_the_old_collapsed_value_is_refused(client, chart, login):
    """«income_statement» is not a statement anybody prints — it was my shortcut, and it is gone."""
    admin = login("admin")
    resp = _account(client, chart, admin, appears_in="income_statement")
    assert resp.status_code == 409, resp.text


def test_the_main_level_is_stored_and_editable(client, chart, login):
    admin = login("admin")
    created = _account(client, chart, admin, main_level="مصروفات غير مباشرة")
    assert created.status_code == 201, created.text
    assert created.json()["main_level"] == "مصروفات غير مباشرة"

    edited = client.patch(f"/api/v1/accounts/{created.json()['id']}", headers=admin,
                          json={"main_level": "مصروفات مباشرة"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["main_level"] == "مصروفات مباشرة"


def test_appears_in_is_optional_and_defaults_to_following_the_nature(client, chart, login):
    admin = login("admin")
    created = _account(client, chart, admin, code="5.10.990")
    assert created.status_code == 201, created.text
    assert created.json()["appears_in"] is None
    assert created.json()["main_level"] is None


# --- الربط: كشف الحساب ← المستند ------------------------------------------------------------


@pytest.fixture()
def ready(client, inv_world, login):
    """A customer with stock behind them, so a real sale can be posted and then read back."""
    admin = login("admin")
    wh = inv_world["central_wh"]
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف الربط", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=admin, json={"name": "مورد الربط"}).json()
    client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"],
        "location": {"location_kind": "warehouse", "location_id": wh},
        "cash_amount": "600", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "10", "unit_price": "60"}]})
    customer = client.post("/api/v1/customers", headers=admin, json={
        "name": "عميل الربط", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    return {"admin": admin, "wh": wh, "item_id": item["id"], "customer_id": customer["id"]}


def test_a_statement_line_names_the_invoice_behind_it(client, ready):
    """The invoice's own statement line carries enough to open the invoice."""
    admin = ready["admin"]
    invoice = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": ready["customer_id"],
        "origin": {"location_kind": "warehouse", "location_id": ready["wh"]},
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "100",
        "lines": [{"item_id": ready["item_id"], "quantity": "1", "discount_pct": "0"}],
    })
    assert invoice.status_code == 201, invoice.text
    inv = invoice.json()

    statement = client.get(f"/api/v1/customers/{ready['customer_id']}/statement", headers=admin)
    assert statement.status_code == 200, statement.text
    lines = statement.json()["lines"]
    linked = [ln for ln in lines if ln.get("doc_id") == inv["id"]
              and ln.get("doc_kind") == "invoice"]
    assert linked, f"الفاتورة {inv['id']} مش مربوطة بأي سطر: {lines}"
    assert linked[0]["doc_number"] == inv["document_number"]


def test_a_receipt_voucher_line_names_its_voucher(client, ready):
    admin = ready["admin"]
    receipt = client.post("/api/v1/vouchers/receipts", headers=admin, json={
        "customer_id": ready["customer_id"], "amount": "40"})
    assert receipt.status_code == 201, receipt.text
    voucher = receipt.json()

    statement = client.get(f"/api/v1/customers/{ready['customer_id']}/statement",
                           headers=admin).json()
    linked = [ln for ln in statement["lines"] if ln.get("doc_id") == voucher["id"]
              and ln.get("doc_kind") == "voucher"]
    assert linked, f"السند {voucher['id']} مش مربوط: {statement['lines']}"
    assert linked[0]["doc_number"] == voucher["document_number"]


def test_a_manual_journal_entry_has_no_document_and_says_so(client, chart, login):
    """None is the honest answer for a hand-written entry, not an omission to be guessed at."""
    admin = login("admin")
    entry = client.post("/api/v1/journal-entries", headers=admin, json={
        "description": "قيد يدوي", "date": "2026-07-01", "branch_id": chart["branch_a"],
        "lines": [
            {"account_id": chart["rent"], "direction": "debit", "amount": "10"},
            {"account_id": chart["treasury"], "direction": "credit", "amount": "10"},
        ]})
    assert entry.status_code == 201, entry.text

    statement = client.get(f"/api/v1/accounts/{chart['rent']}/statement", headers=admin)
    assert statement.status_code == 200, statement.text
    manual = [ln for ln in statement.json()["lines"] if ln["entry_id"] == entry.json()["id"]]
    assert manual, "القيد اليدوي مش ظاهر في كشف الحساب"
    assert manual[0]["doc_kind"] is None
    assert manual[0]["doc_id"] is None
