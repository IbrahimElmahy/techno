"""Customer search/filter + the 360° customer file — 025-customer-360."""
from __future__ import annotations

from decimal import Decimal

from tests.conftest import make_customer_with_account


def _seed(db, world):
    a, acc_a = make_customer_with_account(
        db, world["rep_a"], world["terr_a"], code="CUST-A", name="مؤسسة النور")
    b, acc_b = make_customer_with_account(
        db, world["rep_a"], world["terr_a"], code="CUST-B", name="ورشة الأمل")
    a.phone = "01000000001"
    b.phone = "01555555555"
    db.commit()
    return a, acc_a, b, acc_b


def test_search_matches_name_code_and_phone(client, world, db, login):
    a, _, b, _ = _seed(db, world)
    h = login("admin")

    by_name = client.get("/api/v1/customers?q=النور", headers=h)
    assert by_name.status_code == 200, by_name.text
    assert [c["id"] for c in by_name.json()] == [a.id]

    by_code = client.get("/api/v1/customers?q=CUST-B", headers=h)
    assert [c["id"] for c in by_code.json()] == [b.id]

    by_phone = client.get("/api/v1/customers?q=0155", headers=h)
    assert [c["id"] for c in by_phone.json()] == [b.id]


def test_list_carries_balance_and_filters_debtors(client, world, db, login):
    from src.models.ledger import Direction
    from src.services import account_resolver, ledger_service

    a, acc_a, b, _ = _seed(db, world)
    treasury = account_resolver.treasury_account(db)
    # A credit sale leaves customer A owing 500; customer B owes nothing.
    ledger_service.post_entry(
        db, entry_type="test_sale", actor_user_id=world["admin"], description="بيع آجل",
        lines=[ledger_service.LineInput(acc_a.id, Direction.debit, Decimal("500.00")),
               ledger_service.LineInput(treasury.id, Direction.credit, Decimal("500.00"))],
    )
    db.commit()

    h = login("admin")
    rows = client.get("/api/v1/customers", headers=h).json()
    balances = {c["id"]: Decimal(c["balance"]) for c in rows}
    assert balances[a.id] == Decimal("500.00")
    assert balances[b.id] == Decimal("0.00")

    debtors = client.get("/api/v1/customers?balance_filter=debtors", headers=h).json()
    assert [c["id"] for c in debtors] == [a.id]
    settled = client.get("/api/v1/customers?balance_filter=settled", headers=h).json()
    assert [c["id"] for c in settled] == [b.id]


def test_profile_gathers_the_customers_whole_file(client, world, db, login):
    from src.models.ledger import Direction
    from src.services import account_resolver, ledger_service

    a, acc_a, _, _ = _seed(db, world)
    treasury = account_resolver.treasury_account(db)
    ledger_service.post_entry(
        db, entry_type="test_sale", actor_user_id=world["admin"], description="بيع آجل",
        lines=[ledger_service.LineInput(acc_a.id, Direction.debit, Decimal("300.00")),
               ledger_service.LineInput(treasury.id, Direction.credit, Decimal("300.00"))],
    )
    db.commit()

    resp = client.get(f"/api/v1/customers/{a.id}/profile", headers=login("admin"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["customer"]["id"] == a.id
    assert Decimal(body["balance"]) == Decimal("300.00")
    # The sections exist even when empty — the UI renders tabs off them unconditionally.
    for section in ("invoices", "returns", "receipts", "cheques", "coupons"):
        assert isinstance(body[section], list)
    # Inspections belong to the END OWNER of the product, not to a trading partner —
    # they are deliberately not part of the commercial customer's file.
    assert "inspections" not in body


def test_record_popup_returns_detail_and_refuses_another_customers_record(
    client, world, db, login
):
    """Every row in the file opens through one endpoint, scoped to THAT customer."""
    from decimal import Decimal as D

    from src.models.ledger import Direction
    from src.models.role import RoleName
    from src.services import account_resolver, ledger_service, voucher_service

    a, acc_a, b, _ = _seed(db, world)
    treasury = account_resolver.treasury_account(db)
    ledger_service.post_entry(
        db, entry_type="test_sale", actor_user_id=world["admin"], description="بيع آجل",
        lines=[ledger_service.LineInput(acc_a.id, Direction.debit, D("900.00")),
               ledger_service.LineInput(treasury.id, Direction.credit, D("900.00"))],
    )
    v = voucher_service.create_receipt(
        db, customer_id=a.id, amount=D("200.00"), reference="إيصال 1",
        description="تحصيل", payment_method="نقدي",
        actor_user_id=world["admin"], actor_role=RoleName.system_admin)
    db.commit()

    h = login("admin")
    resp = client.get(f"/api/v1/customers/{a.id}/records/receipt/{v.id}", headers=h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "receipt"
    labels = {f["label"]: f["value"] for f in body["fields"]}
    assert labels["المبلغ"] == "200.00"
    assert labels["المرجع"] == "إيصال 1"

    # The same voucher opened through a DIFFERENT customer's file is a 404, not a leak.
    assert client.get(f"/api/v1/customers/{b.id}/records/receipt/{v.id}",
                      headers=h).status_code == 404
    # Unknown kinds are rejected too.
    assert client.get(f"/api/v1/customers/{a.id}/records/bogus/1",
                      headers=h).status_code == 404


def test_hard_delete_only_for_a_customer_that_never_moved(client, world, db, login):
    from decimal import Decimal as D

    from src.models.customer import Customer
    from src.models.ledger import Direction
    from src.services import account_resolver, ledger_service

    a, acc_a, b, _ = _seed(db, world)
    h = login("admin")

    # `b` has no history at all → deleted outright.
    assert client.delete(f"/api/v1/customers/{b.id}?hard=true", headers=h).status_code == 204
    db.expunge_all()  # the API used its own session; drop this one's identity map
    assert db.get(Customer, b.id) is None

    # `a` has a ledger movement → refused, with a message telling the user to deactivate.
    treasury = account_resolver.treasury_account(db)
    ledger_service.post_entry(
        db, entry_type="test_sale", actor_user_id=world["admin"], description="بيع آجل",
        lines=[ledger_service.LineInput(acc_a.id, Direction.debit, D("100.00")),
               ledger_service.LineInput(treasury.id, Direction.credit, D("100.00"))],
    )
    db.commit()
    resp = client.delete(f"/api/v1/customers/{a.id}?hard=true", headers=h)
    assert resp.status_code == 409, resp.text
    assert db.get(Customer, a.id) is not None
    # Plain (soft) delete still deactivates him.
    assert client.delete(f"/api/v1/customers/{a.id}", headers=h).status_code == 204
    db.expire_all()
    assert db.get(Customer, a.id).active is False


def test_a_rep_cannot_open_another_reps_customer_file(client, world, db, login):
    _, _, b, _ = _seed(db, world)
    resp = client.get(f"/api/v1/customers/{b.id}/profile", headers=login("rep_b"))
    assert resp.status_code == 403
