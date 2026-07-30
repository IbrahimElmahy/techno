"""بطاقة المورد: تصنيف · البريد · الرقم الضريبي · السجل التجاري · نقدي.

Read off their الموردين form. The supplier record already carried الفرع، محافظه، مدينة، العنوان
والهاتف; these five are what was left.

The one worth pinning is what their form does **not** have: no خصم, no ض.م, no default price
tier — all three of which their customer form does have. That asymmetry is theirs, and inventing
the missing three here would be adding a negotiation to a relationship that is not run that way.
"""


def _supplier(client, h, **extra):
    body = {"name": "مورد البطاقة"}
    body.update(extra)
    return client.post("/api/v1/suppliers", headers=h, json=body)


def test_the_card_fields_are_stored_on_create(client, world, login):
    h = login("admin")
    resp = _supplier(client, h, supplier_type="manufacturer", email="sup@example.com",
                     tax_number="TX-77", commercial_register="CR-88", is_cash=True)
    assert resp.status_code == 201, resp.text
    s = resp.json()
    assert s["supplier_type"] == "manufacturer"
    assert s["email"] == "sup@example.com"
    assert s["tax_number"] == "TX-77"
    assert s["commercial_register"] == "CR-88"
    assert s["is_cash"] is True


def test_the_card_fields_can_be_edited(client, world, login):
    h = login("admin")
    s = _supplier(client, h).json()
    assert s["tax_number"] is None and s["is_cash"] is False

    edited = client.patch(f"/api/v1/suppliers/{s['id']}", headers=h,
                          json={"tax_number": "999", "supplier_type": "importer", "is_cash": True})
    assert edited.status_code == 200, edited.text
    assert edited.json()["tax_number"] == "999"
    assert edited.json()["supplier_type"] == "importer"
    assert edited.json()["is_cash"] is True

    got = client.get(f"/api/v1/suppliers/{s['id']}", headers=h).json()
    assert got["tax_number"] == "999"


def test_a_patch_that_does_not_mention_a_field_leaves_it_alone(client, world, login):
    """Editing the phone must not wipe the tax number entered off a paper invoice."""
    h = login("admin")
    s = _supplier(client, h, tax_number="555", commercial_register="CR-1").json()

    client.patch(f"/api/v1/suppliers/{s['id']}", headers=h, json={"phone": "01055555555"})

    got = client.get(f"/api/v1/suppliers/{s['id']}", headers=h).json()
    assert got["tax_number"] == "555"
    assert got["commercial_register"] == "CR-1"
    assert got["phone"] == "01055555555"


def test_the_supplier_type_list_is_admin_configurable(client, world, login):
    """تصنيف is a free lookup like the customer's, not an enum — admins add their own kinds.

    Nothing branches on the value, so a type nobody seeded must still be storable.
    """
    h = login("admin")
    resp = client.get("/api/v1/settings/lookups", headers=h,
                      params={"category": "supplier_type"})
    assert resp.status_code == 200, resp.text
    # Lazily seeded on first read, so the screen has something to show out of the box.
    assert {o["value"] for o in resp.json()} >= {"manufacturer", "importer", "distributor"}

    s = _supplier(client, h, name="مورد بتصنيف من عندنا",
                  supplier_type="ورشة محلية").json()
    assert s["supplier_type"] == "ورشة محلية"


def test_the_list_carries_the_card_fields(client, world, login):
    """Their list leads with الفرع, so the list has to arrive with more than a name and a phone."""
    h = login("admin")
    s = _supplier(client, h, name="مورد القائمة", branch_id=world["branch_a"],
                  supplier_type="distributor", is_cash=True).json()

    rows = client.get("/api/v1/suppliers", headers=h).json()
    row = next(r for r in rows if r["id"] == s["id"])
    assert row["branch_id"] == world["branch_a"]
    assert row["supplier_type"] == "distributor"
    assert row["is_cash"] is True
