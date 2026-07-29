"""وصف على خيار القائمة (فئات الأصناف وغيرها).

Their فئات الأصناف screen has four columns: number, name, hidden, description. We already had the
first three — the list has always been an entity with an order and a hidden flag. This is the
fourth, and it goes on the lookup rather than into a new table for the same reason the list was
never duplicated in the first place.
"""


def test_a_category_can_carry_a_description(client, world, login):
    admin = login("admin")
    created = client.post("/api/v1/settings/lookups", headers=admin, json={
        "category": "item_category", "value": "insulated", "label": "تكنو ثيرم معزول",
        "description": "المواسير المعزولة بكل مقاساتها"})
    assert created.status_code in (200, 201), created.text
    assert created.json()["description"] == "المواسير المعزولة بكل مقاساتها"


def test_the_description_can_be_edited_and_cleared(client, world, login):
    admin = login("admin")
    opt = client.post("/api/v1/settings/lookups", headers=admin, json={
        "category": "item_category", "value": "plain", "label": "تكنو ثيرم"}).json()
    assert opt["description"] is None

    edited = client.patch(f"/api/v1/settings/lookups/{opt['id']}", headers=admin,
                          json={"description": "السادة"})
    assert edited.json()["description"] == "السادة"

    # A note is a note: emptying it is a valid state, not a missing value.
    cleared = client.patch(f"/api/v1/settings/lookups/{opt['id']}", headers=admin,
                           json={"description": ""})
    assert cleared.json()["description"] is None


def test_hiding_a_category_keeps_its_description(client, world, login):
    """The hidden flag and the note are independent — hiding is not deleting."""
    admin = login("admin")
    opt = client.post("/api/v1/settings/lookups", headers=admin, json={
        "category": "item_category", "value": "legacy", "label": "قديم",
        "description": "مش بيتباع تاني"}).json()
    hidden = client.patch(f"/api/v1/settings/lookups/{opt['id']}", headers=admin,
                          json={"active": False})
    assert hidden.json()["active"] is False
    assert hidden.json()["description"] == "مش بيتباع تاني"
