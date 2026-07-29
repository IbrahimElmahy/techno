"""حقول البيانات الأساسية اللي كانت ناقصة، مقروءة من شاشاتهم عمود عمود.

Their الموردين list shows فرع · محافظه · مدينة; ours had none of the three, while the customer had
carried all of them since 001. Their المخازن list shows a وصف. Their الموظفين list shows a store
per employee. None of it is exotic — it is the difference between a record you can read and one
you have to ask someone about.
"""


def test_a_supplier_records_where_he_is(client, world, login):
    admin = login("admin")
    created = client.post("/api/v1/suppliers", headers=admin, json={
        "name": "مورد المحافظة", "phone": "01000000000",
        "branch_id": world["branch_a"], "markaz": "دمنهور"})
    assert created.status_code in (200, 201), created.text
    sup = created.json()
    assert sup["branch_id"] == world["branch_a"]
    assert sup["markaz"] == "دمنهور"


def test_a_supplier_location_can_be_edited(client, world, login):
    admin = login("admin")
    sup = client.post("/api/v1/suppliers", headers=admin, json={"name": "مورد"}).json()
    assert sup["markaz"] is None

    edited = client.patch(f"/api/v1/suppliers/{sup['id']}", headers=admin,
                          json={"markaz": "كفر الدوار", "branch_id": world["branch_b"]})
    assert edited.status_code == 200, edited.text
    assert edited.json()["markaz"] == "كفر الدوار"
    assert edited.json()["branch_id"] == world["branch_b"]


def test_a_warehouse_carries_a_description(client, world, login):
    admin = login("admin")
    created = client.post("/api/v1/warehouses", headers=admin, json={
        "name": "مخزن السيارة أ", "warehouse_type": "branch",
        "branch_id": world["branch_a"], "description": "عهدة مندوب البحيرة"})
    assert created.status_code in (200, 201), created.text
    wh = created.json()
    assert wh["description"] == "عهدة مندوب البحيرة"

    edited = client.patch(f"/api/v1/warehouses/{wh['id']}", headers=admin,
                          json={"description": "اتغيّرت"})
    assert edited.json()["description"] == "اتغيّرت"


def test_an_employee_belongs_to_a_store(client, world, login, db):
    """Their list shows a store per employee — a driver's van, a storekeeper's floor."""
    admin = login("admin")
    wh = client.post("/api/v1/warehouses", headers=admin, json={
        "name": "مخزن الموظف", "warehouse_type": "branch",
        "branch_id": world["branch_a"]}).json()

    emp = client.post("/api/v1/employees", headers=admin, json={
        "name": "سائق السيارة", "warehouse_id": wh["id"], "branch_id": world["branch_a"]})
    assert emp.status_code == 201, emp.text
    assert emp.json()["warehouse_id"] == wh["id"]

    # And an employee with no store is still valid — most office staff have none.
    other = client.post("/api/v1/employees", headers=admin, json={"name": "محاسب"})
    assert other.status_code == 201, other.text
    assert other.json()["warehouse_id"] is None
