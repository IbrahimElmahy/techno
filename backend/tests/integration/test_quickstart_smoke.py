"""T064: end-to-end quickstart smoke + index verification."""
from src.models.customer import Customer
from src.models.ledger import LedgerLine
from src.models.user import User


def _col_indexed(model, name: str) -> bool:
    col = model.__table__.columns[name]
    # Either a column-level index=True or membership in a composite Index.
    return bool(col.index) or any(col in idx.columns for idx in model.__table__.indexes)


def test_quickstart_happy_path(client, world, login):
    admin = login("admin")
    # Org already seeded by `world`; create a warehouse + custody + customer, post + read balances.
    wh = client.post(
        "/api/v1/warehouses", headers=admin,
        json={"name": "Central", "warehouse_type": "central"},
    )
    assert wh.status_code == 201
    custody = client.post(
        "/api/v1/custodies", headers=admin, json={"holder_type": "rep", "rep_id": world["rep_a"]}
    ).json()
    cust = client.post(
        "/api/v1/customers", headers=admin,
        json={"name": "Smoke", "customer_type": "trader",
              "rep_id": world["rep_a"], "territory_id": world["terr_a"]},
    ).json()

    treasury_acc = client.get("/api/v1/treasury/balance", headers=admin).json()["account_id"]
    cust_acc = client.get(f"/api/v1/customers/{cust['id']}/account", headers=admin).json()["account_id"]
    entry = client.post(
        "/api/v1/ledger/entries", headers=admin,
        json={"entry_type": "credit_sale",
              "lines": [
                  {"account_id": cust_acc, "direction": "debit", "amount": "150.00"},
                  {"account_id": treasury_acc, "direction": "credit", "amount": "150.00"},
              ]},
    ).json()
    # Receivable reflects the posting; reversal nets it back to zero.
    assert client.get(
        f"/api/v1/customers/{cust['id']}/account", headers=admin
    ).json()["balance"] == "150.00"
    client.post(f"/api/v1/ledger/entries/{entry['id']}/reverse", headers=admin)
    assert client.get(
        f"/api/v1/customers/{cust['id']}/account", headers=admin
    ).json()["balance"] == "0.00"


def test_expected_indexes_present():
    # plan Performance: hot lookups are indexed.
    assert _col_indexed(LedgerLine, "account_id")
    assert _col_indexed(Customer, "code")
    assert _col_indexed(User, "username")
