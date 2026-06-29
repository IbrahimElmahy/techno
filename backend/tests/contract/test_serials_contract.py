"""T019: serial endpoints + fields present in the generated OpenAPI."""
from src.main import app


def test_serial_paths_present():
    paths = app.openapi()["paths"]
    assert "/api/v1/items/{item_id}/serials" in paths
    assert "get" in paths["/api/v1/items/{item_id}/serials"]
    assert "/api/v1/items/{item_id}/serials/receive" in paths
    assert "post" in paths["/api/v1/items/{item_id}/serials/receive"]


def test_item_and_sale_line_expose_serial_fields():
    spec = app.openapi()
    schemas = spec["components"]["schemas"]
    assert "is_serialized" in schemas["ItemOut"]["properties"]
    assert "serials" in schemas["SaleLineIn"]["properties"]


def test_sales_return_line_exposes_serials():
    # Resolve the sales-returns request body schema via its $ref and assert the line carries `serials`.
    spec = app.openapi()
    rb = spec["paths"]["/api/v1/sales/{sale_id}/returns"]["post"]["requestBody"]
    ref = rb["content"]["application/json"]["schema"]["$ref"].split("/")[-1]
    schemas = spec["components"]["schemas"]
    line_ref = schemas[ref]["properties"]["lines"]["items"]["$ref"].split("/")[-1]
    assert "serials" in schemas[line_ref]["properties"]
