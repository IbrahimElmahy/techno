"""T049: new endpoints present + error envelopes for no-negative-stock / scope."""
import re

import pytest

_PARAM = re.compile(r"\{[^}]+\}")


@pytest.fixture()
def paths(client):
    spec = client.get("/openapi.json").json()
    return {_PARAM.sub("{}", p) for p in spec["paths"]}


def test_new_paths_present(paths):
    for p in [
        "/api/v1/items",
        "/api/v1/stock/on-hand",
        "/api/v1/suppliers",
        "/api/v1/purchases",
        "/api/v1/purchases/{}/returns",
        "/api/v1/manufacturing/consume",
        "/api/v1/manufacturing/produce",
        "/api/v1/manufacturing/{}/reverse",
        "/api/v1/sales",
        "/api/v1/sales/{}/returns",
        "/api/v1/transfers",
        "/api/v1/transfers/{}/approve",
        "/api/v1/settings/sales",
    ]:
        assert p in paths, f"missing {p}"


def test_forbidden_envelope_for_scope(client, inv_world, login):
    # Sales Rep lacks manufacture.write.
    r = client.post("/api/v1/manufacturing/consume", headers=login("rep_a"), json={
        "item_id": 1, "location": {"location_kind": "warehouse", "location_id": 1}, "quantity": "1"})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


def test_no_negative_stock_envelope(client, inv_world, login):
    admin = login("admin")
    raw = client.post("/api/v1/items", headers=admin, json={
        "name": "Steel", "kind": "raw_material", "unit_of_measure": "kg"}).json()
    # Consume with no stock → 409 no-negative.
    r = client.post("/api/v1/manufacturing/consume", headers=admin, json={
        "item_id": raw["id"], "location": {"location_kind": "warehouse", "location_id": 1},
        "quantity": "5"})
    assert r.status_code == 409
