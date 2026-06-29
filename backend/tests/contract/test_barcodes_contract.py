"""T013: barcode endpoints present in the generated OpenAPI."""
from src.main import app


def test_barcode_paths_present():
    paths = app.openapi()["paths"]
    assert "/api/v1/items/{item_id}/barcodes" in paths
    assert "get" in paths["/api/v1/items/{item_id}/barcodes"]
    assert "put" in paths["/api/v1/items/{item_id}/barcodes"]
    assert "/api/v1/barcodes/{code}" in paths
    assert "get" in paths["/api/v1/barcodes/{code}"]
