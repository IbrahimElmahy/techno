"""T020: cost-center endpoints + the cost_center_id dimension are present in the generated OpenAPI."""
from src.main import app


def test_cost_center_paths_present():
    paths = app.openapi()["paths"]
    expected = [
        ("/api/v1/cost-centers", "get"),
        ("/api/v1/cost-centers", "post"),
        ("/api/v1/cost-centers/{cost_center_id}", "get"),
        ("/api/v1/cost-centers/{cost_center_id}", "patch"),
        ("/api/v1/cost-centers/{cost_center_id}", "delete"),
    ]
    for path, method in expected:
        assert path in paths, f"missing {path}"
        assert method in paths[path], f"missing {method.upper()} {path}"


def test_journal_line_exposes_cost_center_id():
    schemas = app.openapi()["components"]["schemas"]
    assert "cost_center_id" in schemas["JournalLineIn"]["properties"]
    assert "cost_center_id" in schemas["JournalLineOut"]["properties"]


def test_trial_balance_exposes_cost_center_param():
    params = app.openapi()["paths"]["/api/v1/trial-balance"]["get"].get("parameters", [])
    names = {p["name"] for p in params}
    assert "cost_center_id" in names


def test_unauthenticated_denied(client):
    assert client.get("/api/v1/cost-centers").status_code in (401, 403)
