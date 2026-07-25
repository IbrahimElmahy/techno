"""Supplier search/filter + the 360° supplier file — 026-supplier-360."""
from __future__ import annotations

from decimal import Decimal


def _supplier(db, *, code: str, name: str, phone: str | None = None):
    from src.models.ledger import Account, AccountType, Direction
    from src.models.supplier import Supplier, SupplierAccount

    acc = Account(account_type=AccountType.supplier_payable, normal_side=Direction.credit)
    db.add(acc)
    db.flush()
    s = Supplier(code=code, name=name, phone=phone)
    db.add(s)
    db.flush()
    link = SupplierAccount(supplier_id=s.id, account_id=acc.id)
    db.add(link)
    db.flush()
    acc.owner_ref = link.id
    db.flush()
    return s, acc


def _seed(db):
    a, acc_a = _supplier(db, code="SUP-A", name="مصنع النصر للأنابيب", phone="01000000001")
    b, acc_b = _supplier(db, code="SUP-B", name="موّرد الصبغات", phone="01555555555")
    db.commit()
    return a, acc_a, b, acc_b


def test_search_matches_name_code_and_phone(client, world, db, login):
    a, _, b, _ = _seed(db)
    h = login("admin")

    assert [s["id"] for s in client.get("/api/v1/suppliers?q=النصر", headers=h).json()] == [a.id]
    assert [s["id"] for s in client.get("/api/v1/suppliers?q=SUP-B", headers=h).json()] == [b.id]
    assert [s["id"] for s in client.get("/api/v1/suppliers?q=0155", headers=h).json()] == [b.id]


def test_list_carries_balance_and_filters_by_due(client, world, db, login):
    from src.models.ledger import Direction
    from src.services import account_resolver, ledger_service

    a, acc_a, b, _ = _seed(db)
    treasury = account_resolver.treasury_account(db)
    # A credit purchase leaves us owing supplier A 700; supplier B is settled.
    ledger_service.post_entry(
        db, entry_type="test_purchase", actor_user_id=world["admin"], description="شراء آجل",
        lines=[ledger_service.LineInput(treasury.id, Direction.debit, Decimal("700.00")),
               ledger_service.LineInput(acc_a.id, Direction.credit, Decimal("700.00"))],
    )
    db.commit()

    h = login("admin")
    rows = client.get("/api/v1/suppliers", headers=h).json()
    balances = {s["id"]: Decimal(s["balance"]) for s in rows}
    assert balances[a.id] == Decimal("700.00")
    assert balances[b.id] == Decimal("0.00")

    due = client.get("/api/v1/suppliers?balance_filter=due", headers=h).json()
    assert [s["id"] for s in due] == [a.id]
    settled = client.get("/api/v1/suppliers?balance_filter=settled", headers=h).json()
    assert [s["id"] for s in settled] == [b.id]


def test_profile_gathers_the_suppliers_whole_file(client, world, db, login):
    from src.models.ledger import Direction
    from src.services import account_resolver, ledger_service

    a, acc_a, _, _ = _seed(db)
    treasury = account_resolver.treasury_account(db)
    ledger_service.post_entry(
        db, entry_type="test_purchase", actor_user_id=world["admin"], description="شراء آجل",
        lines=[ledger_service.LineInput(treasury.id, Direction.debit, Decimal("400.00")),
               ledger_service.LineInput(acc_a.id, Direction.credit, Decimal("400.00"))],
    )
    db.commit()

    resp = client.get(f"/api/v1/suppliers/{a.id}/profile", headers=login("admin"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["supplier"]["id"] == a.id
    assert Decimal(body["balance"]) == Decimal("400.00")
    for section in ("purchases", "returns", "payments", "cheques"):
        assert isinstance(body[section], list)


def test_record_popup_is_scoped_to_that_supplier(client, world, db, login):
    from src.models.ledger import Direction
    from src.models.role import RoleName
    from src.services import account_resolver, ledger_service, voucher_service

    a, _, b, _ = _seed(db)
    # The treasury must actually hold cash before a payment can leave it.
    treasury = account_resolver.treasury_account(db)
    equity = account_resolver.opening_balance_equity_account(db)
    ledger_service.post_entry(
        db, entry_type="opening_balance", actor_user_id=world["admin"], description="رصيد افتتاحي",
        lines=[ledger_service.LineInput(treasury.id, Direction.debit, Decimal("1000.00")),
               ledger_service.LineInput(equity.id, Direction.credit, Decimal("1000.00"))],
    )
    db.flush()
    v = voucher_service.create_payment(
        db, supplier_id=a.id, amount=Decimal("250.00"), reference="إذن صرف 1",
        description="دفعة للمورد", payment_method="نقدي",
        actor_user_id=world["admin"], actor_role=RoleName.system_admin)
    db.commit()

    h = login("admin")
    resp = client.get(f"/api/v1/suppliers/{a.id}/records/payment/{v.id}", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["voucher"]["amount"] == "250.00"

    # The same voucher through another supplier's file is a 404, not a leak.
    assert client.get(f"/api/v1/suppliers/{b.id}/records/payment/{v.id}",
                      headers=h).status_code == 404
    assert client.get(f"/api/v1/suppliers/{a.id}/records/bogus/1", headers=h).status_code == 404


def test_hard_delete_only_for_a_supplier_that_never_moved(client, world, db, login):
    from src.models.ledger import Direction
    from src.models.supplier import Supplier
    from src.services import account_resolver, ledger_service

    a, acc_a, b, _ = _seed(db)
    h = login("admin")

    assert client.delete(f"/api/v1/suppliers/{b.id}?hard=true", headers=h).status_code == 204
    db.expunge_all()
    assert db.get(Supplier, b.id) is None

    treasury = account_resolver.treasury_account(db)
    ledger_service.post_entry(
        db, entry_type="test_purchase", actor_user_id=world["admin"], description="شراء آجل",
        lines=[ledger_service.LineInput(treasury.id, Direction.debit, Decimal("100.00")),
               ledger_service.LineInput(acc_a.id, Direction.credit, Decimal("100.00"))],
    )
    db.commit()
    assert client.delete(f"/api/v1/suppliers/{a.id}?hard=true", headers=h).status_code == 409
    assert client.delete(f"/api/v1/suppliers/{a.id}", headers=h).status_code == 204
    db.expire_all()
    assert db.get(Supplier, a.id).active is False
