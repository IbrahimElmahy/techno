"""T063: contract checks — endpoint presence, error envelopes, status codes.

Validates the live FastAPI surface against the committed contract's expectations.
"""
import pytest


@pytest.fixture()
def spec(client):
    return client.get("/openapi.json").json()


def test_core_paths_present(spec):
    paths = spec["paths"]
    for p in [
        "/api/v1/auth/login",
        "/api/v1/auth/me",
        "/api/v1/users",
        "/api/v1/branches",
        "/api/v1/territories",
        "/api/v1/warehouses",
        "/api/v1/custodies",
        "/api/v1/treasury/balance",
        "/api/v1/ledger/entries",
        "/api/v1/customers",
        "/api/v1/customers/{customer_id}/reassign",
        "/api/v1/customers/{customer_id}/account",
        "/api/v1/audit",
    ]:
        assert p in paths, f"missing path {p}"


def test_unauthorized_envelope(client, world):
    resp = client.get("/api/v1/users")
    assert resp.status_code == 401
    assert resp.json()["detail"]["code"] == "unauthorized"


def test_forbidden_envelope(client, world, login):
    resp = client.get("/api/v1/users", headers=login("rep_a"))
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"


def test_not_found_envelope(client, world, login):
    resp = client.get("/api/v1/users/999999", headers=login("admin"))
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "not_found"


def test_ledger_validation_error_envelope(client, world, login):
    admin = login("admin")
    treasury_acc = client.get("/api/v1/treasury/balance", headers=admin).json()["account_id"]
    # Unbalanced entry -> 422 with ledger_invalid code.
    resp = client.post(
        "/api/v1/ledger/entries",
        headers=admin,
        json={
            "entry_type": "bad",
            "lines": [
                {"account_id": treasury_acc, "direction": "debit", "amount": "100.00"},
                {"account_id": treasury_acc, "direction": "credit", "amount": "90.00"},
            ],
        },
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "ledger_invalid"
