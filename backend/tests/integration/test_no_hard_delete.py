"""T054: referenced records are not hard-deleted; deactivation preserves history.

FR-023; spec Edge Case.
"""
from src.models.ledger import LedgerEntry
from src.models.user import User


def test_no_delete_endpoint_for_customers(client, world, login):
    admin = login("admin")
    c = client.post(
        "/api/v1/customers",
        headers=admin,
        json={
            "name": "Keep", "customer_type": "trader",
            "rep_id": world["rep_a"], "territory_id": world["terr_a"],
        },
    ).json()
    # No hard-delete route is exposed -> method not allowed on the existing resource path.
    resp = client.delete(f"/api/v1/customers/{c['id']}", headers=admin)
    assert resp.status_code == 405


def test_deactivation_preserves_user_and_ledger_history(client, world, login, Session):
    admin = login("admin")
    # An admin-authored ledger entry exists (treasury + custody handover).
    treasury_acc = client.get("/api/v1/treasury/balance", headers=admin).json()["account_id"]
    custody = client.post(
        "/api/v1/custodies", headers=admin, json={"holder_type": "rep", "rep_id": world["rep_a"]}
    ).json()
    custody_acc = client.get(
        f"/api/v1/custodies/{custody['id']}/balance", headers=admin
    ).json()["account_id"]
    entry = client.post(
        "/api/v1/ledger/entries",
        headers=admin,
        json={
            "entry_type": "cash_handover",
            "lines": [
                {"account_id": treasury_acc, "direction": "debit", "amount": "10.00"},
                {"account_id": custody_acc, "direction": "credit", "amount": "10.00"},
            ],
        },
    ).json()

    # Deactivate the rep (referenced by custody); record persists, not deleted.
    client.post(f"/api/v1/users/{world['rep_a']}/deactivate", headers=admin)

    s = Session()
    rep = s.get(User, world["rep_a"])
    assert rep is not None and rep.active is False  # preserved, not removed
    assert s.get(LedgerEntry, entry["id"]) is not None  # ledger history intact
    s.close()
