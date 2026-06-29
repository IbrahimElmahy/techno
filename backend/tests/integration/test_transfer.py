"""T043: transfer approval by source-branch manager. FR-022–024; US5."""
from decimal import Decimal


def _on_hand(client, h, item_id, kind, loc):
    return Decimal(client.get("/api/v1/stock/on-hand", headers=h,
                   params={"item_id": item_id, "location_kind": kind, "location_id": loc}).json()["on_hand"])


def test_rep_to_rep_source_branch_approval(client, inv_world, login):
    admin = login("admin")
    prod = client.post("/api/v1/items", headers=admin,
                       json={"name": "Gadget", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": "100"}).json()
    # Seed custody_a (rep_a, Branch A) with 20.
    client.post("/api/v1/manufacturing/produce", headers=admin, json={
        "item_id": prod["id"], "location": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "quantity": "20"})

    t = client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "20", "route": "rep_to_rep",
        "source": {"location_kind": "custody", "location_id": inv_world["custody_a"]},
        "dest": {"location_kind": "custody", "location_id": inv_world["custody_b"]}}).json()
    # Pending: no stock moved.
    assert _on_hand(client, admin, prod["id"], "custody", inv_world["custody_a"]) == Decimal("20.000")

    # Branch B manager (non-source) is denied.
    assert client.post(f"/api/v1/transfers/{t['id']}/approve", headers=login("bm_b")).status_code == 403
    # Branch A manager (source branch) approves → atomic out/in.
    ok = client.post(f"/api/v1/transfers/{t['id']}/approve", headers=login("bm_a"))
    assert ok.status_code == 200, ok.text
    assert _on_hand(client, admin, prod["id"], "custody", inv_world["custody_a"]) == Decimal("0.000")
    assert _on_hand(client, admin, prod["id"], "custody", inv_world["custody_b"]) == Decimal("20.000")

    # Reverse moves it back.
    client.post(f"/api/v1/transfers/{t['id']}/reverse", headers=login("bm_a"))
    assert _on_hand(client, admin, prod["id"], "custody", inv_world["custody_a"]) == Decimal("20.000")


def test_illegal_route_rejected(client, inv_world, login):
    admin = login("admin")
    prod = client.post("/api/v1/items", headers=admin,
                       json={"name": "G", "kind": "product", "unit_of_measure": "piece",
                             "sale_price": "1"}).json()
    # rep_to_rep requires custody source; giving a warehouse source is illegal.
    assert client.post("/api/v1/transfers", headers=admin, json={
        "item_id": prod["id"], "quantity": "1", "route": "rep_to_rep",
        "source": {"location_kind": "warehouse", "location_id": inv_world["central_wh"]},
        "dest": {"location_kind": "custody", "location_id": inv_world["custody_b"]}}).status_code == 422
