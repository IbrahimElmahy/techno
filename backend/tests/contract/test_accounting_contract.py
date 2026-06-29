"""T032: the 005 accounting endpoints are present in the generated OpenAPI; error envelopes."""
from src.main import app


def test_accounting_paths_present():
    paths = app.openapi()["paths"]
    expected = [
        ("/api/v1/accounts", "get"),
        ("/api/v1/accounts", "post"),
        ("/api/v1/accounts/{account_id}", "get"),
        ("/api/v1/accounts/{account_id}", "patch"),
        ("/api/v1/accounts/{account_id}", "delete"),
        ("/api/v1/journal-entries", "get"),
        ("/api/v1/journal-entries", "post"),
        ("/api/v1/journal-entries/{entry_id}", "get"),
        ("/api/v1/journal-entries/{entry_id}/reverse", "post"),
        ("/api/v1/opening-balances", "post"),
        ("/api/v1/trial-balance", "get"),
    ]
    for path, method in expected:
        assert path in paths, f"missing {path}"
        assert method in paths[path], f"missing {method.upper()} {path}"


def test_unauthenticated_denied(client):
    # No bearer token -> 401/403, never 200.
    assert client.get("/api/v1/accounts").status_code in (401, 403)
    assert client.get("/api/v1/trial-balance?from=2026-01-01&to=2026-12-31").status_code in (401, 403)


def test_trial_balance_requires_capability(chart, client, login):
    h = login("rep_a")  # sales rep — no accounting cap
    resp = client.get("/api/v1/trial-balance?from=2026-01-01&to=2026-12-31", headers=h)
    assert resp.status_code == 403
