"""دمج العملاء من على السيرفر — 031-a5-restructure.

The merge existed only as a service anyone could call from their own machine, which is how
production kept its duplicated customers while every local copy had them joined. A deploy carries
code and does not touch data, and that difference is invisible from outside.

Running it where the data is means an endpoint, and an endpoint that rewrites every customer is
worth pinning down. Three things are checked here, and they are the three that make it safe to
point at a live database: only an admin can call it, asking without `apply` changes nothing, and
the money is the same afterwards as before.
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select


def _customer(client, h, name, **extra):
    body = {"name": name, "customer_type": "trader", **extra}
    res = client.post("/api/v1/customers", headers=h, json=body)
    assert res.status_code in (200, 201), res.text
    return res.json()


def _receivable_total(db) -> Decimal:
    from src.models.customer import CustomerAccount
    from src.services import ledger_service
    return sum(
        (ledger_service.balance_of(db, a.account_id)
         for a in db.scalars(select(CustomerAccount)).all()),
        Decimal("0"),
    )


def test_only_an_admin_can_run_it(client, inv_world, login):
    """It rewrites every duplicated customer in the system. That is not a thing a salesman does by
    finding the URL."""
    res = client.post("/api/v1/admin/merge-customers", headers=login("rep_a"))
    assert res.status_code == 403, res.text


def test_asking_for_the_plan_changes_nothing(client, inv_world, login, db):
    h = login("admin")
    rep, terr = inv_world["rep_a"], inv_world["terr_a"]
    _customer(client, h, "محمد عامر", rep_id=rep, territory_id=terr)
    _customer(client, h, "تكنو محمد عامر", rep_id=rep, territory_id=terr)
    db.commit()

    before_names = sorted(c.name for c in db.scalars(select(__import__(
        "src.models.customer", fromlist=["Customer"]).Customer)).all())
    before_total = _receivable_total(db)

    res = client.post("/api/v1/admin/merge-customers", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["applied"] is False, "«خطة» اللي بتنفّذ مش خطة"
    # It has to actually SEE the pair, or the test proves only that nothing happened.
    assert len(body["pairs"]) >= 1

    # And it has to NAME both sides. The screen showed «86 عميل متكرّر» over two blank columns for
    # a while, because it read `keep_name`/`merge_name` while the plan returns `keep`/`merge` as
    # nested objects. A plan that says how many will merge and not WHICH account survives is not a
    # plan anybody can approve — and it is the only thing standing before an irreversible merge.
    pair = body["pairs"][0]
    for side in ("keep", "merge"):
        assert isinstance(pair[side], dict), f"«{side}» لازم يبقى كائن فيه id و name"
        assert pair[side]["id"], f"«{side}» من غير رقم"
        assert pair[side]["name"], f"«{side}» من غير اسم"
    assert pair["base_name"]

    db.expire_all()
    after_names = sorted(c.name for c in db.scalars(select(__import__(
        "src.models.customer", fromlist=["Customer"]).Customer)).all())
    assert after_names == before_names, "الخطة ماتغيّرش حاجة"
    assert _receivable_total(db) == before_total


def test_applying_joins_them_and_leaves_the_money_alone(client, inv_world, login, db):
    """The whole safety argument in one test: the two become one, and the total does not move.

    A merge repoints a ledger account at a different owner. If a balance changed, something moved
    money, and that is a bug rather than a merge.
    """
    from src.models.customer import Customer

    h = login("admin")
    rep, terr = inv_world["rep_a"], inv_world["terr_a"]
    keep = _customer(client, h, "سمير فؤاد", rep_id=rep, territory_id=terr)
    dupe = _customer(client, h, "تكنو سمير فؤاد", rep_id=rep, territory_id=terr)
    db.commit()
    before_total = _receivable_total(db)

    res = client.post("/api/v1/admin/merge-customers?apply=true", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["applied"] is True
    assert body["balance_before"] == body["balance_after"], "الدمج مالوش حق يحرّك مليم"

    db.expire_all()
    assert _receivable_total(db) == before_total

    # Nothing is deleted: the duplicate row survives so a document naming it still resolves to a
    # name rather than to a dangling id.
    assert db.get(Customer, dupe["id"]) is not None
    assert db.get(Customer, keep["id"]) is not None


def test_running_it_twice_is_not_a_second_merge(client, inv_world, login, db):
    """The realistic accident: somebody presses it again, or it is run once per environment. The
    second pass must find nothing left to join rather than nesting them further."""
    h = login("admin")
    rep, terr = inv_world["rep_a"], inv_world["terr_a"]
    _customer(client, h, "هالة رشدي", rep_id=rep, territory_id=terr)
    _customer(client, h, "تكنو هالة رشدي", rep_id=rep, territory_id=terr)
    db.commit()

    first = client.post("/api/v1/admin/merge-customers?apply=true", headers=h).json()
    assert len(first["pairs"]) >= 1

    second = client.post("/api/v1/admin/merge-customers?apply=true", headers=h).json()
    joined = [p["base_name"] for p in second["pairs"]]
    assert "هالة رشدي" not in joined, "اتدمج مرتين"
    assert second["balance_before"] == second["balance_after"]


def test_the_fast_total_agrees_with_the_slow_one(client, inv_world, login, db):
    """المجموع السريع لازم يطلع نفس الرقم بالظبط.

    The merge proves it moved no money by totalling every customer balance before and after. That
    total was a loop calling `balance_of` per account — 233 round trips pulling every ledger line
    in the system across the wire, done twice, which took the request past the serverless timeout:
    the merge answered 503 having done nothing at all.

    It is one aggregate query now, and the guard is only worth anything if the new arithmetic is
    the SAME arithmetic. A faster total that disagrees would not fail loudly — it would refuse
    every merge, or wave a real discrepancy through.
    """
    from decimal import Decimal

    from sqlalchemy import select

    from src.models.customer import CustomerAccount
    from src.models.treasury import Treasury
    from src.services import ledger_service

    h = login("admin")
    rep, terr = inv_world["rep_a"], inv_world["terr_a"]
    # A real balance on at least one account, or the two totals agree trivially at zero and the
    # test proves only that 0 == 0.
    cust = _customer(client, h, "منى فتحي", rep_id=rep, territory_id=terr)
    treasury = db.scalars(select(Treasury)).first()
    res = client.post("/api/v1/vouchers/receipts", headers=h, json={
        "customer_id": cust["id"], "amount": "250.75", "payment_method": "cash",
        "treasury_id": treasury.id if treasury else None})
    assert res.status_code in (200, 201), res.text
    db.commit()

    ids = db.scalars(select(CustomerAccount.account_id)).all()
    slow = sum((ledger_service.balance_of(db, i) for i in ids), Decimal("0"))
    fast = ledger_service.total_balance_of(db, ids)
    assert fast == slow, f"المجموع السريع {fast} مش مطابق للبطيء {slow}"


def test_the_fast_total_of_nothing_is_zero(db):
    """The empty case, because `IN ()` is where an aggregate quietly returns NULL."""
    from decimal import Decimal

    from src.services import ledger_service
    assert ledger_service.total_balance_of(db, []) == Decimal("0")


def test_the_merge_does_not_scale_its_queries_with_the_pairs(client, inv_world, login, db):
    """عدد الاستعلامات ثابت مهما كان عدد العملاء.

    The merge ran two `SELECT ... WHERE customer_id = ?` per pair plus a `get` per side — over 190
    round trips for the client's 86 duplicates, to a database that is not on the same machine. On a
    serverless function with a hard time limit that is not «slow», it is a failure: the request
    answered 503 having merged nothing, twice.

    So the count is pinned rather than the duration. A timing assertion would be flaky on a laptop
    and meaningless in CI; the query count is the thing that actually changed and it is exact.
    """
    from sqlalchemy import event, select

    from src.core.db import engine
    from src.models.customer import Customer

    h = login("admin")
    rep, terr = inv_world["rep_a"], inv_world["terr_a"]
    for i in range(12):
        _customer(client, h, f"عميل مكرر {i}", rep_id=rep, territory_id=terr)
        _customer(client, h, f"تكنو عميل مكرر {i}", rep_id=rep, territory_id=terr)
    db.commit()

    seen = []
    def count(conn, cur, stmt, params, ctx, many):
        seen.append(stmt)
    event.listen(engine, "before_cursor_execute", count)
    try:
        from src.services import customer_merge_service
        result = customer_merge_service.apply(db, dry_run=False)
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert len(result["pairs"]) >= 12, "لازم يكون فعلاً دمج عدد كبير"
    # Well under one per pair. The old shape would have been north of 25 for twelve.
    assert len(seen) <= 8, f"عدد الاستعلامات بيزيد مع الأزواج: {len(seen)} لـ {len(result['pairs'])} زوج"
