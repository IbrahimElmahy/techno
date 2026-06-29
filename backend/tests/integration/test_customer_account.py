"""T051: customer create + derived account; stable code; no loyalty schema.

US3 scenarios 1-3; SC-004; FR-022.
"""
from sqlalchemy import inspect

from src.models.customer import Customer


def test_create_customer_has_code_and_zero_derived_balance(client, world, login):
    admin = login("admin")
    created = client.post(
        "/api/v1/customers",
        headers=admin,
        json={
            "name": "Trader One",
            "customer_type": "trader",
            "rep_id": world["rep_a"],
            "territory_id": world["terr_a"],
            "phone": "0100",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["code"].startswith("CUST-")
    acct = client.get(f"/api/v1/customers/{body['id']}/account", headers=admin).json()
    assert acct["balance"] == "0.00"
    assert acct["balance_derived"] is True


def test_duplicate_phone_flagged_not_blocked(client, world, login):
    admin = login("admin")
    base = {
        "customer_type": "other",
        "rep_id": world["rep_a"],
        "territory_id": world["terr_a"],
        "phone": "0111",
    }
    first = client.post("/api/v1/customers", headers=admin, json={"name": "A", **base})
    second = client.post("/api/v1/customers", headers=admin, json={"name": "B", **base})
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] in second.json()["duplicate_phone_customer_ids"]


def test_no_loyalty_schema_on_customer():
    # FR-022: loyalty owned by After-Sales; no loyalty column in Foundation.
    cols = {c.key for c in inspect(Customer).columns}
    assert not any("loyalty" in c or "point" in c for c in cols)
