"""T018: 012 credit endpoints present in the generated OpenAPI + customer schema fields."""
from src.main import app


def test_credit_report_paths_present():
    paths = app.openapi()["paths"]
    assert "/api/v1/reports/credit-exposure" in paths
    assert "get" in paths["/api/v1/reports/credit-exposure"]
    assert "/api/v1/reports/overdue" in paths
    assert "get" in paths["/api/v1/reports/overdue"]


def test_customer_schema_exposes_credit_fields():
    props = app.openapi()["components"]["schemas"]["CustomerOut"]["properties"]
    assert "credit_limit" in props
    assert "max_due_term_days" in props
