"""VAT / ضريبة القيمة المضافة — 021-tax-commissions.

Opt-in by design: the rate ships at 0, and at 0 every posting is exactly what it was before
VAT existed (no tax line, no change to the cash/credit validation). Turning it on is a
deliberate settings change, so a live book cannot silently start charging tax.

Output tax (on sales) is a liability; input tax (on purchases) is an asset that offsets it.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from src.core.money import ZERO, to_money
from src.models.ledger import Account, AccountNature, AccountType, Direction, LedgerLine
from src.models.sales import SalesSetting

OUTPUT_TAX_CODE = "2160"  # ضريبة القيمة المضافة المستحقة
INPUT_TAX_CODE = "1160"   # ضريبة القيمة المضافة على المشتريات


def vat_rate(db: Session) -> Decimal:
    """The configured VAT percentage (0 = disabled)."""
    setting = db.scalar(select(SalesSetting).limit(1))
    if setting is None or setting.vat_rate_pct is None:
        return Decimal("0")
    return Decimal(str(setting.vat_rate_pct))


def tax_on(amount, rate: Decimal) -> Decimal:
    """Tax due on a net amount at a percentage rate. Zero rate ⇒ exactly zero."""
    if rate <= 0:
        return ZERO
    return to_money(to_money(amount) * rate / Decimal("100"))


def _tax_account(db: Session, *, code: str, name: str, nature: AccountNature) -> Account:
    acc = db.scalar(select(Account).where(Account.code == code))
    if acc is None:
        acc = Account(
            account_type=AccountType.user_defined, owner_ref=None,
            normal_side=Direction.credit if nature == AccountNature.liability
            else Direction.debit,
            code=code, name=name, nature=nature, is_postable=True, is_system=True,
        )
        db.add(acc)
        db.flush()
    return acc


def output_tax_account(db: Session) -> Account:
    return _tax_account(db, code=OUTPUT_TAX_CODE, name="ضريبة القيمة المضافة المستحقة",
                        nature=AccountNature.liability)


def input_tax_account(db: Session) -> Account:
    return _tax_account(db, code=INPUT_TAX_CODE, name="ضريبة القيمة المضافة على المشتريات",
                        nature=AccountNature.asset)


def vat_return(
    db: Session, *, date_from: date | None = None, date_to: date | None = None
) -> dict:
    """الإقرار الضريبي — ضريبة المبيعات ناقص ضريبة المشتريات خلال الفترة."""
    def _movement(account: Account) -> Decimal:
        rows = db.scalars(
            select(LedgerLine).options(selectinload(LedgerLine.entry))
            .where(LedgerLine.account_id == account.id)
        ).all()
        total = ZERO
        for line in rows:
            when = line.entry.entry_date or line.entry.created_at.date()
            if date_from is not None and when < date_from:
                continue
            if date_to is not None and when > date_to:
                continue
            amount = to_money(line.amount)
            total += amount if line.direction == account.normal_side else -amount
        return to_money(total)

    output = _movement(output_tax_account(db))
    input_ = _movement(input_tax_account(db))
    return {
        "date_from": date_from,
        "date_to": date_to,
        "rate_pct": vat_rate(db),
        "output_tax": output,          # على المبيعات
        "input_tax": input_,           # على المشتريات
        "net_payable": to_money(output - input_),
    }
