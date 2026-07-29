"""التوجيه المحاسبي — توجيه الدور المحاسبي لحساب من دليل حسابات العميل.

Their اعدادات القاعدة has a whole tab of these: «المبيعات → أي حساب»، «الخزينة → أي حساب». Ours
resolved every role to an account it had seeded itself — which cannot be misconfigured, and is also
wrong for a client whose accountant already has a chart and wants revenue where their auditor looks
for it.

The tests that matter are the ones about safety: the override must be honoured by real posting (not
merely read back), it must refuse targets that would break the trial balance, and there must be a way
back to the default.
"""
from sqlalchemy import select


def test_every_role_reads_back_with_its_default(client, chart, login):
    admin = login("admin")
    rows = client.get("/api/v1/account-routing", headers=admin)
    assert rows.status_code == 200, rows.text
    by_role = {r["role"]: r for r in rows.json()}
    assert "sales_revenue" in by_role
    # Nothing configured yet, and the reader is told so — «default» and «configured» look identical
    # once posted, so an admin chasing a wrong statement needs to see which one this is.
    assert by_role["sales_revenue"]["source"] == "default"
    assert by_role["sales_revenue"]["account_id"]


def test_a_routed_role_is_used_by_real_posting(client, chart, inv_world, login, db):
    """The whole point of the setting: a sale must actually land on the chosen account."""
    from src.models.ledger import LedgerLine

    admin = login("admin")
    target = client.post("/api/v1/accounts", headers=admin, json={
        "code": "4.900", "name": "مبيعات المحاسب", "nature": "income",
        "is_postable": True, "parent_id": chart["groups"]["4"]})
    assert target.status_code == 201, target.text
    tid = target.json()["id"]

    routed = client.put("/api/v1/account-routing", headers=admin,
                        json={"role": "sales_revenue", "account_id": tid})
    assert routed.status_code == 200, routed.text
    by_role = {r["role"]: r for r in routed.json()}
    assert by_role["sales_revenue"]["account_id"] == tid
    assert by_role["sales_revenue"]["source"] == "configured"

    wh = inv_world["central_wh"]
    loc = {"location_kind": "warehouse", "location_id": wh}
    item = client.post("/api/v1/items", headers=admin, json={
        "name": "صنف التوجيه", "kind": "product", "unit_of_measure": "piece",
        "sale_price": "100"}).json()
    sup = client.post("/api/v1/suppliers", headers=admin, json={"name": "مورد التوجيه"}).json()
    client.post("/api/v1/purchases", headers=admin, json={
        "supplier_id": sup["id"], "location": loc, "cash_amount": "300", "credit_amount": "0",
        "lines": [{"item_id": item["id"], "quantity": "5", "unit_price": "60"}]})
    customer = client.post("/api/v1/customers", headers=admin, json={
        "name": "عميل التوجيه", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    sale = client.post("/api/v1/sales", headers=admin, json={
        "customer_id": customer["id"], "origin": loc,
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "100",
        "lines": [{"item_id": item["id"], "quantity": "1", "discount_pct": "0"}]})
    assert sale.status_code == 201, sale.text

    lines = db.scalars(
        select(LedgerLine).where(LedgerLine.entry_id == sale.json()["ledger_entry_id"])
    ).all()
    credited = {ln.account_id for ln in lines if ln.direction.value == "credit"}
    assert tid in credited, "الإيراد رُحّل على الحساب الافتراضي مش الحساب الموجّه ليه"


def test_a_group_account_is_refused(client, chart, login):
    """Routing to a group would produce entries the trial balance cannot roll up."""
    admin = login("admin")
    group = client.post("/api/v1/accounts", headers=admin, json={
        "code": "4.800", "name": "مجموعة إيرادات", "nature": "income",
        "is_postable": False, "parent_id": chart["groups"]["4"]})
    assert group.status_code == 201, group.text
    resp = client.put("/api/v1/account-routing", headers=admin,
                      json={"role": "sales_revenue", "account_id": group.json()["id"]})
    assert resp.status_code == 409, resp.text


def test_an_unknown_role_is_refused(client, chart, login):
    admin = login("admin")
    resp = client.put("/api/v1/account-routing", headers=admin,
                      json={"role": "not_a_role", "account_id": 1})
    assert resp.status_code == 409, resp.text


def test_clearing_a_role_restores_the_default(client, chart, login):
    """The way back, for when a role is pointed somewhere wrong and the books need the safe one."""
    admin = login("admin")
    default_id = next(r["account_id"] for r in
                      client.get("/api/v1/account-routing", headers=admin).json()
                      if r["role"] == "sales_revenue")
    target = client.post("/api/v1/accounts", headers=admin, json={
        "code": "4.901", "name": "مبيعات مؤقتة", "nature": "income",
        "is_postable": True, "parent_id": chart["groups"]["4"]}).json()

    client.put("/api/v1/account-routing", headers=admin,
               json={"role": "sales_revenue", "account_id": target["id"]})
    cleared = client.put("/api/v1/account-routing", headers=admin,
                         json={"role": "sales_revenue", "account_id": None})
    assert cleared.status_code == 200, cleared.text
    row = next(r for r in cleared.json() if r["role"] == "sales_revenue")
    assert row["source"] == "default"
    assert row["account_id"] == default_id


def test_a_nature_mismatch_warns_but_does_not_block(client, chart, login):
    """The accountant may mean it — we say so, we do not overrule them."""
    admin = login("admin")
    expense_leaf = client.post("/api/v1/accounts", headers=admin, json={
        "code": "5.10.777", "name": "حساب غريب", "nature": "expense", "is_postable": True,
        "parent_id": chart["expense_group"]}).json()
    resp = client.put("/api/v1/account-routing", headers=admin,
                      json={"role": "sales_revenue", "account_id": expense_leaf["id"]})
    assert resp.status_code == 200, resp.text
    row = next(r for r in resp.json() if r["role"] == "sales_revenue")
    assert row["nature_warning"], "المفروض يحذّر إن طبيعة الحساب مختلفة"


def test_the_per_party_roles_are_not_offered(client, chart, login):
    """Receivables are per party here — routing them to one account would end every statement.

    Not an oversight: their «العملاء» mapping works because they keep one control account with a
    subsidiary ledger beside it. Ours puts the detail in the chart, which is what makes «كشف حساب
    العميل» and the aging report possible at all, and that is not a setting to be toggled.
    """
    admin = login("admin")
    roles = {r["role"] for r in client.get("/api/v1/account-routing", headers=admin).json()}
    assert "customer_receivable" not in roles
    assert "supplier_payable" not in roles

    target = client.post("/api/v1/accounts", headers=admin, json={
        "code": "1.900", "name": "عملاء مجمّع", "nature": "asset",
        "is_postable": True, "parent_id": chart["groups"]["1"]}).json()
    resp = client.put("/api/v1/account-routing", headers=admin,
                      json={"role": "customer_receivable", "account_id": target["id"]})
    assert resp.status_code == 409, resp.text


def test_a_deactivated_target_falls_back_instead_of_posting_to_a_closed_account(
    client, chart, login
):
    """Posting to a closed account surfaces weeks later in a statement nobody can explain."""
    admin = login("admin")
    target = client.post("/api/v1/accounts", headers=admin, json={
        "code": "4.902", "name": "مبيعات هتتقفل", "nature": "income",
        "is_postable": True, "parent_id": chart["groups"]["4"]}).json()
    client.put("/api/v1/account-routing", headers=admin,
               json={"role": "sales_revenue", "account_id": target["id"]})
    removed = client.delete(f"/api/v1/accounts/{target['id']}", headers=admin)
    assert removed.status_code in (200, 204), removed.text

    row = next(r for r in client.get("/api/v1/account-routing", headers=admin).json()
               if r["role"] == "sales_revenue")
    assert row["source"] == "default"
    assert row["account_id"] != target["id"]
