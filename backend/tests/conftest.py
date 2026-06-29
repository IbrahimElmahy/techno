"""Test harness (T009): disposable in-memory DB, client, per-role auth fixtures."""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.core.db import Base, get_db
from src.core.security import hash_password
from src.main import app
from src.models.ledger import Account, AccountType, Direction
from src.models.org import Branch, Governorate, Territory
from src.models.role import Role, RoleName
from src.models.user import User
from src.models.warehouse import Custody, HolderType, Warehouse, WarehouseType


@pytest.fixture()
def engine():
    eng = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def Session(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture()
def db(Session):
    s = Session()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def client(Session):
    def _override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _role(db, name: RoleName) -> Role:
    r = db.query(Role).filter(Role.name == name).one_or_none()
    if r is None:
        r = Role(name=name)
        db.add(r)
        db.flush()
    return r


def _user(db, username, role_name, *, branch_id=None, territory_id=None, pw="pw") -> User:
    u = User(
        username=username,
        password_hash=hash_password(pw),
        role_id=_role(db, role_name).id,
        full_name=username,
        branch_id=branch_id,
        territory_id=territory_id,
    )
    db.add(u)
    db.flush()
    return u


@pytest.fixture()
def world(db):
    """A two-branch organization with one user per role. Returns ids + login helper."""
    gov = Governorate(name="Cairo")
    gov2 = Governorate(name="Giza")
    db.add_all([gov, gov2])
    db.flush()
    branch_a = Branch(name="Branch A", governorate_id=gov.id)
    branch_b = Branch(name="Branch B", governorate_id=gov2.id)
    db.add_all([branch_a, branch_b])
    db.flush()
    terr_a = Territory(name="Terr A", branch_id=branch_a.id)
    terr_b = Territory(name="Terr B", branch_id=branch_b.id)
    db.add_all([terr_a, terr_b])
    db.flush()

    admin = _user(db, "admin", RoleName.system_admin)
    bm_a = _user(db, "bm_a", RoleName.branch_manager, branch_id=branch_a.id)
    bm_b = _user(db, "bm_b", RoleName.branch_manager, branch_id=branch_b.id)
    sm_a = _user(db, "sm_a", RoleName.sales_manager, branch_id=branch_a.id)
    asales = _user(db, "asales", RoleName.after_sales_staff)
    rep_a = _user(db, "rep_a", RoleName.sales_rep, branch_id=branch_a.id, territory_id=terr_a.id)
    rep_b = _user(db, "rep_b", RoleName.sales_rep, branch_id=branch_b.id, territory_id=terr_b.id)
    # General Ledger (005): a company-wide accountant + a branch-scoped accountant.
    acct = _user(db, "acct", RoleName.accountant)
    acct_a = _user(db, "acct_a", RoleName.accountant, branch_id=branch_a.id)
    db.commit()

    return {
        "branch_a": branch_a.id,
        "branch_b": branch_b.id,
        "terr_a": terr_a.id,
        "terr_b": terr_b.id,
        "admin": admin.id,
        "bm_a": bm_a.id,
        "bm_b": bm_b.id,
        "sm_a": sm_a.id,
        "asales": asales.id,
        "rep_a": rep_a.id,
        "rep_b": rep_b.id,
        "acct": acct.id,
        "acct_a": acct_a.id,
    }


@pytest.fixture()
def login(client):
    """Return a helper that logs in and yields an Authorization header dict."""

    def _login(username: str, pw: str = "pw") -> dict:
        resp = client.post("/api/v1/auth/login", json={"username": username, "password": pw})
        assert resp.status_code == 200, resp.text
        return {"Authorization": f"Bearer {resp.json()['access_token']}"}

    return _login


def _custody_with_account(db, rep_id: int) -> Custody:
    acc = Account(account_type=AccountType.custody, normal_side=Direction.debit)
    db.add(acc)
    db.flush()
    c = Custody(holder_type=HolderType.rep, rep_id=rep_id, account_id=acc.id)
    db.add(c)
    db.flush()
    acc.owner_ref = c.id
    db.flush()
    return c


def make_customer_with_account(db, rep_id, territory_id, code="CUST-L1", name="LoyalCust"):
    """A customer + a ledger-backed receivable account (reused by sales/loyalty tests)."""
    from src.models.customer import Customer, CustomerAccount

    cust = Customer(code=code, name=name, customer_type="trader",
                    rep_id=rep_id, territory_id=territory_id)
    db.add(cust)
    db.flush()
    acc = Account(account_type=AccountType.customer_receivable, normal_side=Direction.debit)
    db.add(acc)
    db.flush()
    db.add(CustomerAccount(customer_id=cust.id, account_id=acc.id))
    db.flush()
    acc.owner_ref = cust.id
    db.flush()
    return cust, acc


@pytest.fixture()
def chart(db, world):
    """Foundation `world` + the seeded standard chart of accounts (groups + system leaves) and a
    couple of user-defined postable expense leaves for journal tests (005)."""
    from src.models.ledger import AccountNature
    from src.services import chart_service

    groups = chart_service.seed_standard_chart(db)
    # A user-defined expense group + two postable leaves under it.
    rent = chart_service.create_account(
        db, code="5.10.001", name="إيجار", nature=AccountNature.expense, is_postable=True,
        parent_id=_expense_subgroup(db, chart_service, groups).id,
    )
    salaries = chart_service.create_account(
        db, code="5.10.002", name="رواتب", nature=AccountNature.expense, is_postable=True,
        parent_id=rent.parent_id,
    )
    db.commit()
    return {
        **world,
        "groups": {code: g.id for code, g in groups.items()},
        "treasury": next(a.id for a in _accounts_by_code(db, "1.01.001")),
        "opening_equity": next(a.id for a in _accounts_by_code(db, "3.001")),
        "sales_revenue": next(a.id for a in _accounts_by_code(db, "4.001")),
        "rent": rent.id,
        "salaries": salaries.id,
        "expense_group": rent.parent_id,
    }


def _expense_subgroup(db, chart_service, groups):
    """Create (once) a '5.10' expense group under the 'Cost & Expenses' heading."""
    from src.models.ledger import Account, AccountNature

    existing = db.query(Account).filter(Account.code == "5.10").one_or_none()
    if existing is not None:
        return existing
    return chart_service.create_account(
        db, code="5.10", name="مصروفات تشغيلية", nature=AccountNature.expense,
        is_postable=False, parent_id=groups["5"].id,
    )


def _accounts_by_code(db, code):
    from src.models.ledger import Account

    return db.query(Account).filter(Account.code == code).all()


def make_priced_product(db, *, name="TieredGadget", sale_price="100", tiers=None):
    """A product item with a base sale_price and optional per-tier prices (007)."""
    from src.models.catalog import Item, ItemKind, ItemPrice, PriceTier

    n = db.query(Item).count()
    item = Item(code=f"PR-{n + 1:06d}", name=name, kind=ItemKind.product,
                unit_of_measure="piece", sale_price=Decimal(sale_price))
    db.add(item)
    db.flush()
    for tier_name, price in (tiers or {}).items():
        db.add(ItemPrice(item_id=item.id, tier=PriceTier(tier_name), price=Decimal(price)))
    db.flush()
    return item


def make_serialized_product(db, *, name="SerialGadget", sale_price="100"):
    """A serialized product item (009)."""
    from src.models.catalog import Item, ItemKind

    n = db.query(Item).count()
    item = Item(code=f"PR-{n + 1:06d}", name=name, kind=ItemKind.product,
                unit_of_measure="piece", sale_price=Decimal(sale_price), is_serialized=True)
    db.add(item)
    db.flush()
    return item


def make_unit(db, item, name, factor):
    """Add an alternate unit (name + factor to base) to an item (008)."""
    from src.models.catalog import ItemUnit

    u = ItemUnit(item_id=item.id, name=name, factor=Decimal(str(factor)))
    db.add(u)
    db.flush()
    return u


@pytest.fixture()
def cost_centers(db, chart):
    """The `chart` fixture + a small cost-center master (a root + two children) for 006 tests."""
    from src.services import cost_center_service

    root = cost_center_service.create(db, code="1", name="الفروع")
    nasr = cost_center_service.create(db, code="1.01", name="معرض مدينة نصر", parent_id=root.id)
    maadi = cost_center_service.create(db, code="1.02", name="معرض المعادي", parent_id=root.id)
    db.commit()
    return {**chart, "cc_root": root.id, "cc_nasr": nasr.id, "cc_maadi": maadi.id}


@pytest.fixture()
def inv_world(db, world):
    """Foundation `world` + a central warehouse, a Branch-A warehouse, and rep custodies."""
    central = Warehouse(name="Central", warehouse_type=WarehouseType.central)
    branch_wh = Warehouse(name="WH-A", warehouse_type=WarehouseType.branch, branch_id=world["branch_a"])
    db.add_all([central, branch_wh])
    db.flush()
    cust_a = _custody_with_account(db, world["rep_a"])
    cust_b = _custody_with_account(db, world["rep_b"])
    db.commit()
    return {
        **world,
        "central_wh": central.id,
        "branch_wh": branch_wh.id,
        "custody_a": cust_a.id,
        "custody_b": cust_b.id,
        "custody_a_account": cust_a.account_id,
    }
