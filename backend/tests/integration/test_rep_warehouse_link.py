"""مخزن المندوب وعملاء المندوب — the chain that makes a chosen customer imply a store.

Every link already existed; none of them had ever been walked end to end:

    employee → store    (`employee.warehouse_id`, shown on the الموظفين screen)
    employee → login    (`employee.user_id`)
    customer → rep      (`customer.rep_id`, a USER id, required since 001)
    invoice  → rep      (`sales_invoice.rep_id`)

Reps are picked from **الموظفين**, not from logins: the payroll is where the client already records
who drives which van. The login only enters at the customer end, because «المندوب» on a customer is
a user id.

These tests walk the whole chain, so that a change to any one link fails here rather than showing
up as an invoice quietly served from the wrong store.
"""


def _store(client, h, world, name="مخزن السيارة أ"):
    return client.post("/api/v1/warehouses", headers=h, json={
        "name": name, "warehouse_type": "branch", "branch_id": world["branch_a"]}).json()


def _rep_employee(client, h, world, store_id, *, name="مندوب السيارة أ", user_id=None):
    return client.post("/api/v1/employees", headers=h, json={
        "name": name, "branch_id": world["branch_a"], "warehouse_id": store_id,
        "user_id": user_id}).json()


def test_a_stores_reps_are_its_employees(client, world, login):
    h = login("admin")
    wh = _store(client, h, world)
    emp = _rep_employee(client, h, world, wh["id"])

    reps = client.get(f"/api/v1/warehouses/{wh['id']}/reps", headers=h)
    assert reps.status_code == 200, reps.text
    assert [r["id"] for r in reps.json()] == [emp["id"]]


def test_setting_the_reps_owns_the_set(client, world, login):
    """Saving the list is also how somebody comes off it.

    A PATCH per employee could add but never say «and nobody else», so removal would have needed
    a separate verb nobody remembers to call.
    """
    h = login("admin")
    wh = _store(client, h, world)
    a = _rep_employee(client, h, world, wh["id"], name="مندوب أ")
    b = _rep_employee(client, h, world, wh["id"], name="مندوب ب")

    resp = client.put(f"/api/v1/warehouses/{wh['id']}/reps", headers=h,
                      json={"employee_ids": [a["id"]]})
    assert resp.status_code == 200, resp.text
    assert [r["id"] for r in resp.json()] == [a["id"]]

    # b came off the store rather than staying on it silently.
    remaining = client.get(f"/api/v1/warehouses/{wh['id']}/reps", headers=h).json()
    assert [r["id"] for r in remaining] == [a["id"]]
    assert client.get(f"/api/v1/employees/{b['id']}", headers=h).json()["warehouse_id"] is None


def test_naming_an_employee_on_a_store_moves_him_off_the_old_one(client, world, login):
    """One employee, one store — «مندوب السيارة أ» drives one car."""
    h = login("admin")
    first = _store(client, h, world, "مخزن السيارة أ")
    second = _store(client, h, world, "مخزن السيارة ب")
    emp = _rep_employee(client, h, world, first["id"])

    client.put(f"/api/v1/warehouses/{second['id']}/reps", headers=h,
               json={"employee_ids": [emp["id"]]})

    assert client.get(f"/api/v1/warehouses/{first['id']}/reps", headers=h).json() == []
    assert [r["id"] for r in
            client.get(f"/api/v1/warehouses/{second['id']}/reps", headers=h).json()] == [emp["id"]]


def test_an_unknown_employee_rejects_the_whole_save(client, world, login):
    h = login("admin")
    wh = _store(client, h, world)
    emp = _rep_employee(client, h, world, wh["id"])

    resp = client.put(f"/api/v1/warehouses/{wh['id']}/reps", headers=h,
                      json={"employee_ids": [emp["id"], 999999]})
    assert resp.status_code == 404, resp.text
    # Nothing moved.
    assert [r["id"] for r in
            client.get(f"/api/v1/warehouses/{wh['id']}/reps", headers=h).json()] == [emp["id"]]


def test_the_store_serving_a_customer_is_reachable_from_the_customer(client, world, login):
    """The whole point, walked end to end: customer → rep(login) → employee → store."""
    h = login("admin")
    wh = _store(client, h, world)
    emp = _rep_employee(client, h, world, wh["id"], user_id=world["rep_a"])
    cust = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل خط السيارة أ", "customer_type": "trader",
        "rep_id": world["rep_a"], "territory_id": world["terr_a"]}).json()

    employees = client.get("/api/v1/employees", headers=h).json()
    by_user = {e["user_id"]: e for e in employees if e["user_id"]}
    assert by_user[cust["rep_id"]]["id"] == emp["id"]
    assert by_user[cust["rep_id"]]["warehouse_id"] == wh["id"]


def test_an_employee_without_a_login_can_hold_stock_but_owns_no_customers(client, world, login):
    """A storekeeper is on the payroll and has a store; no customer can point at him.

    «المندوب» on a customer is a login, so an employee without one is reported with a null user
    and the screen can say so, rather than offering a name that cannot be saved.
    """
    h = login("admin")
    wh = _store(client, h, world)
    emp = _rep_employee(client, h, world, wh["id"], name="أمين المخزن")

    rep = client.get(f"/api/v1/warehouses/{wh['id']}/reps", headers=h).json()[0]
    assert rep["id"] == emp["id"]
    assert rep["user_id"] is None


# ---------------------------------------------------------------- عملاء المندوب (bulk assign)


def _customer(client, h, world, name, rep_id):
    return client.post("/api/v1/customers", headers=h, json={
        "name": name, "customer_type": "trader", "rep_id": rep_id,
        "territory_id": world["terr_a"]}).json()


def test_customers_can_be_assigned_to_a_rep_in_one_call(client, world, login):
    h = login("admin")
    a = _customer(client, h, world, "عميل أ", world["rep_a"])
    b = _customer(client, h, world, "عميل ب", world["rep_a"])

    resp = client.post("/api/v1/customers/assign-rep", headers=h, json={
        "rep_id": world["rep_b"], "customer_ids": [a["id"], b["id"]]})
    assert resp.status_code == 200, resp.text
    assert {c["rep_id"] for c in resp.json()} == {world["rep_b"]}


def test_assigning_keeps_each_customers_own_territory(client, world, login):
    """A rep's round is not a customer's area.

    Moving a hundred customers onto the rep's territory as a side effect of naming their rep
    would quietly rewrite the sales geography, with nobody aware it had happened.
    """
    h = login("admin")
    a = client.post("/api/v1/customers", headers=h, json={
        "name": "عميل منطقة ب", "customer_type": "trader",
        "rep_id": world["rep_b"], "territory_id": world["terr_b"]}).json()

    resp = client.post("/api/v1/customers/assign-rep", headers=h, json={
        "rep_id": world["rep_a"], "customer_ids": [a["id"]]})
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["territory_id"] == world["terr_b"]


def test_a_bad_id_rejects_the_whole_batch(client, world, login):
    """All or nothing.

    Assigning ninety of a hundred and failing on the ninety-first leaves nobody able to say which
    ninety moved.
    """
    h = login("admin")
    a = _customer(client, h, world, "عميل سليم", world["rep_a"])

    resp = client.post("/api/v1/customers/assign-rep", headers=h, json={
        "rep_id": world["rep_b"], "customer_ids": [a["id"], 999999]})
    assert resp.status_code == 404, resp.text
    assert client.get(f"/api/v1/customers/{a['id']}", headers=h).json()["rep_id"] == world["rep_a"]


def test_only_a_sales_rep_can_be_given_customers(client, world, login):
    h = login("admin")
    a = _customer(client, h, world, "عميل", world["rep_a"])
    resp = client.post("/api/v1/customers/assign-rep", headers=h, json={
        "rep_id": world["acct"], "customer_ids": [a["id"]]})
    assert resp.status_code == 422, resp.text
