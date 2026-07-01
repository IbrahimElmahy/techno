"""T021: 011 limits/batch endpoints present in the generated OpenAPI."""
from src.main import app


def test_batch_and_report_paths_present():
    paths = app.openapi()["paths"]
    assert "/api/v1/items/{item_id}/batches" in paths
    assert "get" in paths["/api/v1/items/{item_id}/batches"]
    assert "/api/v1/items/{item_id}/batches/receive" in paths
    assert "post" in paths["/api/v1/items/{item_id}/batches/receive"]
    assert "/api/v1/stock/reorder" in paths
    assert "get" in paths["/api/v1/stock/reorder"]
    assert "/api/v1/stock/expiring" in paths
    assert "get" in paths["/api/v1/stock/expiring"]


def test_item_schema_exposes_limits_and_perishable():
    props = app.openapi()["components"]["schemas"]["ItemOut"]["properties"]
    assert "min_stock" in props
    assert "max_stock" in props
    assert "is_perishable" in props
