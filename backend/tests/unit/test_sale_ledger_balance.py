"""T033: split sale posts ONE balanced entry; rep debits custody. FR-020; research R6."""
from decimal import Decimal

from sqlalchemy import select

from src.models.catalog import Item, ItemKind
from src.models.customer import Customer, CustomerAccount
from src.models.ledger import Account, AccountType, Direction, LedgerLine
from src.models.role import RoleName
from src.models.stock import LocationKind, StockDirection
from src.services import account_resolver, sales_service, stock_service
from src.services.sales_service import SaleLine


def _product(db, price="100"):
    it = Item(code="PR-X", name="Gadget", kind=ItemKind.product, unit_of_measure="piece",
              sale_price=Decimal(price))
    db.add(it)
    db.flush()
    return it


def test_rep_split_sale_is_one_balanced_entry_debiting_custody(db, inv_world):
    it = _product(db, "100")
    # stock the rep custody with 5 units
    stock_service.post_movement(db, item_id=it.id, location_kind=LocationKind.custody,
                                location_id=inv_world["custody_a"], movement_type="transfer_in",
                                direction=StockDirection.in_, quantity=Decimal("5"), actor_user_id=1)
    # a customer owned by rep_a
    cust = Customer(code="CUST-X", name="K", customer_type="trader",
                    rep_id=inv_world["rep_a"], territory_id=inv_world["terr_a"])
    db.add(cust)
    db.flush()
    acc = Account(account_type=AccountType.customer_receivable, normal_side=Direction.debit)
    db.add(acc)
    db.flush()
    db.add(CustomerAccount(customer_id=cust.id, account_id=acc.id))
    db.flush()

    inv = sales_service.create_sale(
        db, customer_id=cust.id, origin_location_kind=LocationKind.custody,
        origin_location_id=inv_world["custody_a"], variable_discount_pct=Decimal("0"),
        cash_amount=Decimal("100"), credit_amount=Decimal("200"),
        lines=[SaleLine(it.id, Decimal("3"))], actor_role=RoleName.sales_rep,
        actor_user_id=inv_world["rep_a"],
    )
    db.commit()
    assert inv.net == Decimal("300.00")  # 3 × 100, no discount

    lines = db.scalars(select(LedgerLine).where(LedgerLine.entry_id == inv.ledger_entry_id)).all()
    debit = sum(l.amount for l in lines if l.direction == Direction.debit)
    credit = sum(l.amount for l in lines if l.direction == Direction.credit)
    assert debit == credit == Decimal("300.00")  # one balanced entry

    # The cash leg debits the REP's custody account (not the treasury).
    cash_acc_id = inv_world["custody_a_account"]
    cash_legs = [l for l in lines if l.account_id == cash_acc_id and l.direction == Direction.debit]
    assert len(cash_legs) == 1 and cash_legs[0].amount == Decimal("100.00")
    # Revenue credited the net.
    rev = account_resolver.sales_revenue_account(db)
    rev_legs = [l for l in lines if l.account_id == rev.id and l.direction == Direction.credit]
    assert rev_legs[0].amount == Decimal("300.00")
