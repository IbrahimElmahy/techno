"""الموظفون والوظائف + «يظهر في» — B8.

An employee is not a user. A driver, a storekeeper or a workshop hand is on the payroll and turns
up in reports without ever having a password — and forcing them into the `user` table would mean
creating login accounts for people who must never have one. So they are their own entity, linked
to a user only when the same person happens to be both.
"""
from __future__ import annotations

import pytest


@pytest.fixture()
def admin(client, world, login):
    return login("admin")


def test_an_employee_needs_no_login(client, admin):
    resp = client.post("/api/v1/employees", headers=admin, json={
        "name": "سائق النقل", "department": "النقل", "phone": "01000000000"})
    assert resp.status_code == 201, resp.text
    emp = resp.json()
    assert emp["code"].startswith("EMP-")
    assert emp["user_id"] is None
    assert emp["active"] is True


def test_a_job_title_is_named_once_and_reused(client, admin):
    title = client.post("/api/v1/job-titles", headers=admin,
                        json={"name": "أمين مخزن"}).json()
    emp = client.post("/api/v1/employees", headers=admin, json={
        "name": "أمين مخزن المصنع", "job_title_id": title["id"]}).json()
    assert emp["job_title"] == "أمين مخزن"

    # The same title twice is a mistake, not a second title.
    again = client.post("/api/v1/job-titles", headers=admin, json={"name": "أمين مخزن"})
    assert again.status_code == 409


def test_one_user_cannot_be_two_employees(client, admin, world):
    first = client.post("/api/v1/employees", headers=admin, json={
        "name": "موظف بحساب", "user_id": world["rep_a"]})
    assert first.status_code == 201, first.text
    second = client.post("/api/v1/employees", headers=admin, json={
        "name": "موظف تاني بنفس الحساب", "user_id": world["rep_a"]})
    assert second.status_code == 409


def test_an_employee_is_deactivated_not_deleted(client, admin):
    emp = client.post("/api/v1/employees", headers=admin, json={"name": "للإيقاف"}).json()
    assert client.delete(f"/api/v1/employees/{emp['id']}", headers=admin).status_code == 204

    # Still readable — whatever already references the name must keep resolving it.
    one = client.get(f"/api/v1/employees/{emp['id']}", headers=admin).json()
    assert one["active"] is False
    assert one["name"] == "للإيقاف"

    active_only = client.get("/api/v1/employees", headers=admin, params={"active": True}).json()
    assert all(r["id"] != emp["id"] for r in active_only)


def test_an_employee_can_be_edited(client, admin):
    emp = client.post("/api/v1/employees", headers=admin, json={"name": "قبل"}).json()
    resp = client.patch(f"/api/v1/employees/{emp['id']}", headers=admin,
                        json={"name": "بعد", "department": "الإنتاج", "salary": "5500"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "بعد"
    assert resp.json()["department"] == "الإنتاج"


def test_an_account_can_be_told_where_it_appears(client, chart, login):
    """«يظهر في» — the override for the accounts whose nature does not imply the right face."""
    headers = login("admin")
    account_id = chart["treasury"]

    resp = client.patch(f"/api/v1/accounts/{account_id}", headers=headers,
                        json={"appears_in": "balance_sheet"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["appears_in"] == "balance_sheet"

    bad = client.patch(f"/api/v1/accounts/{account_id}", headers=headers,
                       json={"appears_in": "somewhere_else"})
    assert bad.status_code == 409

    # Blank means "follow the nature", which is what every account does by default.
    cleared = client.patch(f"/api/v1/accounts/{account_id}", headers=headers,
                           json={"appears_in": ""})
    assert cleared.json()["appears_in"] is None
