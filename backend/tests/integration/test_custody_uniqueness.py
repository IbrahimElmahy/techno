"""T043: one custody per holder (FR-025)."""


def test_second_custody_for_same_rep_conflicts(client, world, login):
    admin = login("admin")
    first = client.post(
        "/api/v1/custodies", headers=admin, json={"holder_type": "rep", "rep_id": world["rep_a"]}
    )
    assert first.status_code == 201, first.text
    second = client.post(
        "/api/v1/custodies", headers=admin, json={"holder_type": "rep", "rep_id": world["rep_a"]}
    )
    assert second.status_code == 409


def test_second_custody_for_same_warehouse_conflicts(client, world, login):
    admin = login("admin")
    wh = client.post(
        "/api/v1/warehouses", headers=admin,
        json={"name": "Central", "warehouse_type": "central"},
    ).json()
    a = client.post(
        "/api/v1/custodies", headers=admin,
        json={"holder_type": "warehouse", "warehouse_id": wh["id"]},
    )
    assert a.status_code == 201
    b = client.post(
        "/api/v1/custodies", headers=admin,
        json={"holder_type": "warehouse", "warehouse_id": wh["id"]},
    )
    assert b.status_code == 409
