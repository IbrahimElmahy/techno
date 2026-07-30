"""نقل الخزينة بين الفروع.

`TreasuryPatch` accepted a name, a bank name, an account number and the default flag — but not the
branch. A safe opened against the wrong branch could therefore only be «fixed» by opening a second
one and retiring the first, which splits its cash history across two ledger accounts because of a
wrong pick on the day it was created.

The kind stays locked on purpose: it decides whether the bank fields mean anything, and a cash box
that turns into a bank account halfway through its history is neither.
"""


def _treasury(client, h, world, **extra):
    body = {"name": "خزينة الاختبار", "kind": "cash", "branch_id": world["branch_a"]}
    body.update(extra)
    return client.post("/api/v1/treasuries", headers=h, json=body)


def test_a_treasury_can_move_between_branches(client, world, login):
    h = login("admin")
    t = _treasury(client, h, world).json()
    assert t["branch_id"] == world["branch_a"]

    moved = client.patch(f"/api/v1/treasuries/{t['id']}", headers=h,
                         json={"branch_id": world["branch_b"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["branch_id"] == world["branch_b"]

    # Persisted, and its ledger account did not change with it — the history stays put.
    rows = client.get("/api/v1/treasuries", headers=h).json()
    row = next(r for r in rows if r["id"] == t["id"])
    assert row["branch_id"] == world["branch_b"]
    assert row["account_id"] == t["account_id"]


def test_a_patch_that_does_not_mention_the_branch_leaves_it_alone(client, world, login):
    h = login("admin")
    t = _treasury(client, h, world, name="خزينة الفرع أ").json()

    client.patch(f"/api/v1/treasuries/{t['id']}", headers=h, json={"name": "اسم جديد"})

    rows = client.get("/api/v1/treasuries", headers=h).json()
    row = next(r for r in rows if r["id"] == t["id"])
    assert row["name"] == "اسم جديد"
    assert row["branch_id"] == world["branch_a"]


def test_the_bank_details_survive_a_rename(client, world, login):
    """Renaming a bank account must not lose the account number somebody copied off a statement."""
    h = login("admin")
    t = _treasury(client, h, world, name="حساب البنك", kind="bank",
                  bank_name="البنك الأهلي", account_number="1234567890").json()

    client.patch(f"/api/v1/treasuries/{t['id']}", headers=h, json={"name": "البنك الأهلي — جاري"})

    rows = client.get("/api/v1/treasuries", headers=h).json()
    row = next(r for r in rows if r["id"] == t["id"])
    assert row["bank_name"] == "البنك الأهلي"
    assert row["account_number"] == "1234567890"
