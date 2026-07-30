"""بطاقة العميل: الفرع · البريد · الرقم الضريبي · السجل التجاري · خصم · ض.م · نقدي.

Read off their العملاء form field by field. Seven things it asked for that we had nowhere to put.

The one that needs pinning is **خصم / ض.م being nullable**: NULL means «nothing agreed — use
whatever the item or line says», 0 means «agreed, and it is zero». A customer who negotiated 0%
is a different fact from one nobody has negotiated with, and defaulting the unset ones to 0 would
erase the difference permanently, with nothing left to recover it from.
"""
from decimal import Decimal


def _customer(client, h, world, **extra):
    body = {"name": "عميل البطاقة", "customer_type": "trader",
            "rep_id": world["rep_a"], "territory_id": world["terr_a"]}
    body.update(extra)
    return client.post("/api/v1/customers", headers=h, json=body)


def test_the_card_fields_are_stored_on_create(client, world, login):
    h = login("admin")
    resp = _customer(
        client, h, world,
        branch_id=world["branch_a"], email="nour@example.com", tax_number="123-456-789",
        commercial_register="CR-9910", discount_pct="7.5", vat_pct="14", is_cash=True,
    )
    assert resp.status_code == 201, resp.text
    c = resp.json()
    assert c["branch_id"] == world["branch_a"]
    assert c["email"] == "nour@example.com"
    assert c["tax_number"] == "123-456-789"
    assert c["commercial_register"] == "CR-9910"
    assert Decimal(c["discount_pct"]) == Decimal("7.50")
    assert Decimal(c["vat_pct"]) == Decimal("14.00")
    assert c["is_cash"] is True


def test_the_card_fields_can_be_edited(client, world, login):
    h = login("admin")
    c = _customer(client, h, world).json()
    assert c["tax_number"] is None and c["is_cash"] is False

    edited = client.patch(f"/api/v1/customers/{c['id']}", headers=h, json={
        "tax_number": "555", "branch_id": world["branch_a"], "is_cash": True})
    assert edited.status_code == 200, edited.text
    assert edited.json()["tax_number"] == "555"
    assert edited.json()["branch_id"] == world["branch_a"]
    assert edited.json()["is_cash"] is True

    # Persisted, not just echoed back.
    got = client.get(f"/api/v1/customers/{c['id']}", headers=h).json()
    assert got["tax_number"] == "555"


def test_an_unset_discount_stays_null_rather_than_becoming_zero(client, world, login):
    """The whole reason these two columns are nullable.

    «مفيش اتفاق» and «الاتفاق صفر» have to stay different, because the first means fall back to the
    item's own rate and the second means charge nothing.
    """
    h = login("admin")
    silent = _customer(client, h, world, name="عميل بلا اتفاق").json()
    assert silent["discount_pct"] is None
    assert silent["vat_pct"] is None

    agreed = _customer(client, h, world, name="عميل اتفاقه صفر",
                       discount_pct="0", vat_pct="0").json()
    assert Decimal(agreed["discount_pct"]) == Decimal("0.00")
    assert Decimal(agreed["vat_pct"]) == Decimal("0.00")


def test_a_patch_that_does_not_mention_a_field_leaves_it_alone(client, world, login):
    """Editing the phone must not wipe the tax number the accountant entered last month."""
    h = login("admin")
    c = _customer(client, h, world, tax_number="777", discount_pct="5").json()

    client.patch(f"/api/v1/customers/{c['id']}", headers=h, json={"phone": "01000000000"})

    got = client.get(f"/api/v1/customers/{c['id']}", headers=h).json()
    assert got["tax_number"] == "777"
    assert Decimal(got["discount_pct"]) == Decimal("5.00")
    assert got["phone"] == "01000000000"


def test_the_list_carries_the_branch(client, world, login):
    """«الفرع» is the second column on their list, so it has to arrive with the list."""
    h = login("admin")
    c = _customer(client, h, world, name="عميل الفرع", branch_id=world["branch_a"]).json()

    rows = client.get("/api/v1/customers", headers=h).json()
    row = next(r for r in rows if r["id"] == c["id"])
    assert row["branch_id"] == world["branch_a"]
