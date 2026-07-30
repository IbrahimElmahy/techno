"""أسماء الحسابات الفرعية المشتقة من صاحبها.

An account opened FOR somebody — a customer, a supplier, a safe, a rep's custody — is created by
the system with a balance and no name. Until the الحسابات الفرعيه screen existed nobody had to
read those rows as a list, and when they were finally listed the name column was a column of «-»
against real money: a list you cannot read is a list you cannot check.

Their own subaccounts screen reads «العملاء / تكنو سامى شلبى». These tests pin ours to the same
shape, and pin the two decisions that make it hold:

* the name is DERIVED on read, never copied at creation, so renaming a customer renames his line;
* it is resolved by walking the LINK table back to the account, not forward through
  `Account.owner_ref` — which the API sets and every seeding or import script does not.
"""
from src.models.ledger import Account, AccountType, Direction
from src.models.supplier import Supplier, SupplierAccount
from src.services import chart_service


def _accounts(client, h) -> list[dict]:
    return client.get("/api/v1/accounts", headers=h).json()


def _find(rows: list[dict], account_id: int) -> dict:
    return next(r for r in rows if r["id"] == account_id)


def test_a_customers_account_is_named_after_the_customer(client, world, login):
    h = login("admin")
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "مؤسسة النور", "customer_type": "trader",
        "rep_id": world["rep_a"], "territory_id": world["terr_a"]}).json()
    acc_id = client.get(f"/api/v1/customers/{cust['id']}/account", headers=h).json()["account_id"]

    row = _find(_accounts(client, h), acc_id)
    assert row["owner_name"] == "عميل — مؤسسة النور"
    assert row["owner_group"] == "العملاء"


def test_renaming_the_customer_renames_his_account(client, world, login):
    """The reason it is derived and not stored.

    A copy taken at creation drifts the first time somebody fixes a spelling, and then the chart
    and the customer list disagree with no way to tell which is current.
    """
    h = login("admin")
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "الاسم القديم", "customer_type": "trader",
        "rep_id": world["rep_a"], "territory_id": world["terr_a"]}).json()
    acc_id = client.get(f"/api/v1/customers/{cust['id']}/account", headers=h).json()["account_id"]

    client.patch(f"/api/v1/customers/{cust['id']}", headers=h, json={"name": "الاسم الجديد"})

    assert _find(_accounts(client, h), acc_id)["owner_name"] == "عميل — الاسم الجديد"


def test_a_suppliers_account_is_named_after_the_supplier(client, world, login):
    h = login("admin")
    sup = client.post("/api/v1/suppliers", headers=h, json={"name": "مصنع النصر"}).json()
    acc_id = client.get(f"/api/v1/suppliers/{sup['id']}/account", headers=h).json()["account_id"]

    row = _find(_accounts(client, h), acc_id)
    assert row["owner_name"] == "مورد — مصنع النصر"
    assert row["owner_group"] == "الموردين"


def test_an_account_whose_owner_ref_was_never_set_still_resolves(client, world, login, db):
    """The bug this replaced, pinned so it cannot come back.

    `Account.owner_ref` is written by the API when it creates the pair and left NULL by every
    seeding and import script. Resolving forward through it left two of three suppliers in the dev
    database nameless while the third worked — the kind of gap that reads as «some accounts just
    do not have names» rather than as a bug. The link row is what actually holds the relationship.
    """
    acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit)
    db.add(acc)
    db.flush()
    sup = Supplier(code="SUP-99999", name="مورد بلا owner_ref")
    db.add(sup)
    db.flush()
    db.add(SupplierAccount(supplier_id=sup.id, account_id=acc.id))
    db.flush()
    assert acc.owner_ref is None   # exactly what a seeded row looks like

    names = chart_service.bulk_owner_names(db, [acc])
    assert names[acc.id] == "مورد — مورد بلا owner_ref"


def test_an_account_with_its_own_name_keeps_it(client, world, login):
    """A hand-entered account is not owned by anybody and must not be relabelled."""
    h = login("admin")
    made = client.post("/api/v1/accounts", headers=h, json={
        "code": "5199", "name": "إيجار المقر", "nature": "expense", "is_postable": True}).json()

    row = _find(_accounts(client, h), made["id"])
    assert row["name"] == "إيجار المقر"
    assert row["owner_name"] is None
    assert row["owner_group"] is None
