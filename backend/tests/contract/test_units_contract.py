"""T021: unit endpoints + line fields present in the generated OpenAPI."""
from src.main import app


def test_item_units_paths_present():
    paths = app.openapi()["paths"]
    assert "/api/v1/items/{item_id}/units" in paths
    assert "get" in paths["/api/v1/items/{item_id}/units"]
    assert "put" in paths["/api/v1/items/{item_id}/units"]


def test_line_schemas_expose_unit():
    schemas = app.openapi()["components"]["schemas"]
    assert "unit" in schemas["SaleLineIn"]["properties"]
    assert "unit" in schemas["PurchaseLineIn"]["properties"]
    for f in ("unit", "unit_factor"):
        assert f in schemas["InvoiceLineOut"]["properties"]
