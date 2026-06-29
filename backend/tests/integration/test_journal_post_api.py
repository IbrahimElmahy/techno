"""T017: post journal via API — balances move, branch scope, audit logged, immutable."""
from src.models.audit import AuditLogEntry
from src.models.ledger import LedgerEntry


def _entry(chart, branch_id):
    return {
        "date": "2026-06-28",
        "description": "إيجار",
        "branch_id": branch_id,
        "lines": [
            {"account_id": chart["rent"], "direction": "debit", "amount": "5000.00",
             "statement": "إيجار المعرض"},
            {"account_id": chart["treasury"], "direction": "credit", "amount": "5000.00"},
        ],
    }


def test_post_moves_balances_and_audits(chart, client, login, db):
    h = login("acct")
    resp = client.post("/api/v1/journal-entries", headers=h, json=_entry(chart, chart["branch_a"]))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["entry_type"] == "journal"
    assert body["date"] == "2026-06-28"
    assert body["lines"][0]["statement"] == "إيجار المعرض"

    # rent balance now 5000 debit
    rent = client.get(f"/api/v1/accounts/{chart['rent']}", headers=h).json()
    assert rent["balance"] == "5000.00"

    # audit recorded
    assert db.query(AuditLogEntry).filter(AuditLogEntry.action == "journal.post").count() >= 1


def test_unbalanced_via_api_422(chart, client, login):
    h = login("acct")
    bad = _entry(chart, chart["branch_a"])
    bad["lines"][1]["amount"] = "4000.00"
    resp = client.post("/api/v1/journal-entries", headers=h, json=bad)
    assert resp.status_code == 422


def test_branch_scoped_user_cannot_post_other_branch(chart, client, login):
    h = login("acct_a")  # accountant scoped to branch_a
    resp = client.post("/api/v1/journal-entries", headers=h, json=_entry(chart, chart["branch_b"]))
    assert resp.status_code == 403
    # own branch ok
    resp = client.post("/api/v1/journal-entries", headers=h, json=_entry(chart, chart["branch_a"]))
    assert resp.status_code == 201


def test_posted_entry_is_immutable(chart, client, login, db):
    h = login("acct")
    resp = client.post("/api/v1/journal-entries", headers=h, json=_entry(chart, chart["branch_a"]))
    entry_id = resp.json()["id"]
    entry = db.get(LedgerEntry, entry_id)
    # ORM immutability guard blocks updates
    import pytest

    from src.models.ledger import LedgerImmutableError

    entry.description = "tampered"
    with pytest.raises(LedgerImmutableError):
        db.flush()
    db.rollback()
