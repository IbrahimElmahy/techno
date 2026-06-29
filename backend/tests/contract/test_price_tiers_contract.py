"""T020: price-tier endpoints + fields present in the generated OpenAPI."""
from src.main import app


def test_item_prices_paths_present():
    paths = app.openapi()["paths"]
    assert "/api/v1/items/{item_id}/prices" in paths
    assert "get" in paths["/api/v1/items/{item_id}/prices"]
    assert "put" in paths["/api/v1/items/{item_id}/prices"]


def test_sale_line_exposes_tier_and_unit_price():
    schemas = app.openapi()["components"]["schemas"]
    props = schemas["SaleLineIn"]["properties"]
    assert "tier" in props and "unit_price" in props
    assert "price_tier" in schemas["InvoiceLineOut"]["properties"]


def test_customer_exposes_default_price_tier():
    schemas = app.openapi()["components"]["schemas"]
    assert "default_price_tier" in schemas["CustomerOut"]["properties"]
    assert "default_price_tier" in schemas["CustomerCreate"]["properties"]
