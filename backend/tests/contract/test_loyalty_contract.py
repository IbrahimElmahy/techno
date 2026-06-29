"""T042: loyalty endpoints present + error envelopes."""
import re

import pytest

_PARAM = re.compile(r"\{[^}]+\}")


@pytest.fixture()
def paths(client):
    return {_PARAM.sub("{}", p) for p in client.get("/openapi.json").json()["paths"]}


def test_new_paths_present(paths):
    for p in [
        "/api/v1/loyalty/coupon-types",
        "/api/v1/products/{}/point-value",
        "/api/v1/customers/{}/points",
        "/api/v1/customers/{}/points/convert",
        "/api/v1/coupons",
        "/api/v1/coupons/{}/redeem",
        "/api/v1/coupons/{}/redemption/reverse",
    ]:
        assert p in paths, f"missing {p}"


def test_forbidden_for_non_after_sales(client, inv_world, login):
    # Sales Rep lacks loyalty_settings.write.
    r = client.post("/api/v1/loyalty/coupon-types", headers=login("rep_a"),
                    json={"name": "X", "kind": "money", "point_cost": 10, "value": "10"})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


def test_convert_insufficient_points_409(client, inv_world, login):
    admin, asales = login("admin"), login("asales")
    cust = client.post("/api/v1/customers", headers=admin, json={
        "name": "K", "customer_type": "trader", "rep_id": inv_world["rep_a"],
        "territory_id": inv_world["terr_a"]}).json()
    ct = client.post("/api/v1/loyalty/coupon-types", headers=asales,
                     json={"name": "M", "kind": "money", "point_cost": 50, "value": "50"}).json()
    # customer has 0 points → 409
    r = client.post(f"/api/v1/customers/{cust['id']}/points/convert", headers=asales,
                    json={"coupon_type_ids": [ct["id"]]})
    assert r.status_code == 409
