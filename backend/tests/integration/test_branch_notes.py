"""بيان ١ و بيان ٢ على الفرع — off their الفروع form.

Their branch form asks for exactly three things: الاسم · بيان 1 · بيان 2. The two notes are free
lines on purpose: a branch collects facts that belong to no column, and naming them now would
only be a name somebody has to work around later.
"""


def _gov_id(client, h) -> int:
    return client.get("/api/v1/governorates", headers=h).json()[0]["id"]


def _branch(client, h, world, **extra):
    body = {"name": "فرع البيانات", "governorate_id": _gov_id(client, h)}
    body.update(extra)
    return client.post("/api/v1/branches", headers=h, json=body)


def test_the_notes_are_stored_on_create(client, world, login):
    h = login("admin")
    resp = _branch(client, h, world, note1="المالك: ٠١٠٠٠٠٠٠٠٠٠",
                   note2="التسليم من باب المخزن مش الشارع")
    assert resp.status_code == 201, resp.text
    b = resp.json()
    assert b["note1"] == "المالك: ٠١٠٠٠٠٠٠٠٠٠"
    assert b["note2"] == "التسليم من باب المخزن مش الشارع"


def test_the_notes_come_back_with_the_list(client, world, login):
    """The create response and the list are built by the same helper, so neither can forget."""
    h = login("admin")
    b = _branch(client, h, world, name="فرع القائمة", note1="ملاحظة").json()

    rows = client.get("/api/v1/branches", headers=h).json()
    row = next(r for r in rows if r["id"] == b["id"])
    assert row["note1"] == "ملاحظة"
    assert row["note2"] is None


def test_a_patch_that_does_not_mention_a_note_leaves_it_alone(client, world, login):
    """Renaming a branch must not wipe a note somebody left on it."""
    h = login("admin")
    b = _branch(client, h, world, name="فرع قديم", note1="لا تمسحني").json()

    edited = client.patch(f"/api/v1/branches/{b['id']}", headers=h, json={"name": "فرع جديد"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "فرع جديد"
    assert edited.json()["note1"] == "لا تمسحني"


def test_the_governorate_is_still_required(client, world, login):
    """Their form has no governorate; ours does, and it stays required.

    Dropping a required column that already holds data, to match somebody else's layout, is a
    straight loss — so a branch without one is still refused.
    """
    h = login("admin")
    resp = client.post("/api/v1/branches", headers=h, json={"name": "فرع بلا محافظة"})
    assert resp.status_code == 422, resp.text
