"""T050: role→capability matrix. FR-028."""
from src.core.security import hash_password
from src.models.role import Role, RoleName
from src.models.user import User


def _make_user(Session, username, role_name, branch_id=None):
    s = Session()
    role = s.query(Role).filter(Role.name == role_name).one_or_none()
    if role is None:
        role = Role(name=role_name)
        s.add(role)
        s.flush()
    s.add(User(username=username, password_hash=hash_password("pw"), role_id=role.id,
               full_name=username, branch_id=branch_id))
    s.commit()
    s.close()


def test_purchasing_manager_cannot_sell(client, inv_world, login, Session):
    _make_user(Session, "pm", RoleName.purchasing_manager, branch_id=inv_world["branch_a"])
    h = login("pm")
    r = client.post("/api/v1/sales", headers=h, json={
        "customer_id": 1, "origin": {"location_kind": "custody", "location_id": 1},
        "variable_discount_pct": "0", "cash_amount": "0", "credit_amount": "0", "lines": []})
    assert r.status_code == 403  # no sale.write


def test_sales_manager_cannot_manufacture(client, inv_world, login):
    h = login("sm_a")
    r = client.post("/api/v1/manufacturing/consume", headers=h, json={
        "item_id": 1, "location": {"location_kind": "warehouse", "location_id": 1}, "quantity": "1"})
    assert r.status_code == 403  # no manufacture.write


def test_sales_rep_cannot_approve_transfers(client, inv_world, login):
    h = login("rep_a")
    assert client.post("/api/v1/transfers/1/approve", headers=h).status_code == 403


def test_only_purchasing_manager_records_purchases(client, inv_world, login):
    # Sales Manager lacks purchase.write.
    h = login("sm_a")
    r = client.post("/api/v1/purchases", headers=h, json={
        "supplier_id": 1, "location": {"location_kind": "warehouse", "location_id": 1},
        "cash_amount": "0", "credit_amount": "0", "lines": []})
    assert r.status_code == 403
