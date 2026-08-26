"""Ledger service (T017–T019): post_entry, reverse_entry, balance_of.

The only write paths into the ledger. No update/delete — corrections are reversals (FR-027/028).
All balances are derived here from `ledger_line` (FR-026); nothing is stored standalone.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine


class LedgerError(Exception):
    """Invalid ledger operation (unbalanced, too few lines, double reversal, ...)."""


@dataclass(frozen=True)
class LineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None  # per-line بيان (005); ignored by 001/002/003 callers
    cost_center_id: int | None = None  # optional analytical dimension (006)


def _validate_lines(lines: list[LineInput]) -> None:
    """اللي فاضل من التحقق: سطر واحد على الأقل، وكل سطر بمبلغ موجب.

    كان فيه قاعدتين تانيين اتشالوا بطلب العميل — «سطرين على الأقل» و«مدين = دائن».
    الاتنين قواعد دفتر أستاذ: صح للنظام اللي بيتقفل بميزانية مدققة، وعائق للنظام اللي
    بيتكتب فيه قيد بسيط عشان يظبط رصيد. اللي كان بيكتب قيد بسطر واحد كان بيتقاله «القيد
    لازم يكون فيه سطرين»، فيخترع سطر تاني عشان يعدّي — والنتيجة قيد فيه سطر مالوش معنى
    بدل قيد ناقص بصراحة.

    الحاجتين اللي فاضلين مش قواعد محاسبية، دول شرط إن السطر يبقى ليه معنى أصلاً: قيد من
    غير سطور مش قيد، ومبلغ بصفر أو بالسالب مش مبلغ — والاتجاه (مدين/دائن) هو اللي بيحمل
    الإشارة.

    والمستندات اللي النظام بيكتبها بنفسه (بيع، شرا، سندات) بتطلع متوازنة بحكم بنائها،
    فمافيش حاجة فيها اتغيّرت.
    """
    if not lines:
        raise LedgerError("القيد لازم يكون فيه سطر واحد على الأقل.")
    if any(to_money(l.amount) <= ZERO for l in lines):
        raise LedgerError("كل سطر لازم يكون مبلغه أكبر من صفر.")


def _assert_period_open(db: Session, when: date | None) -> None:
    """إقفال الفترة — اتشال بطلب العميل، والدالة سايبة كعلامة على المكان.

    كانت بترفض أي ترحيل بتاريخ جوّه شهر الحسابات قفلته: «الفترة مقفلة حتى ٣١/٠٧ — لا يمكن
    الترحيل بتاريخ ٢٥/٠٧». دي قاعدة دفتر أستاذ صح للنظام اللي بيتقفل بميزانية مدققة
    وبتتقدّم لجهة برّه؛ الشركة دي مش بتشتغل كده، والفاتورة اللي اتأخرت شهر لازم تتكتب
    بتاريخها الحقيقي مش بتاريخ النهارده.

    الدالة سايبة فاضية بدل ما نداءها يتشال من `post_entry`: المكان ده هو الطريق الوحيد
    اللي بيدخل الدفتر، ولو رجع يوم قفل الفترة، هيرجع هنا — مش في سبع حتة مختلفة.
    """
    return


def post_entry(
    db: Session,
    *,
    entry_type: str,
    actor_user_id: int,
    lines: list[LineInput],
    description: str = "",
    rep_id: int | None = None,
    branch_id: int | None = None,
    reverses_entry_id: int | None = None,
    entry_date: date | None = None,
) -> LedgerEntry:
    """Append a balanced, immutable entry. Returns the persisted entry with lines."""
    _validate_lines(lines)
    _assert_period_open(db, entry_date)
    entry = LedgerEntry(
        entry_type=entry_type,
        description=description,
        actor_user_id=actor_user_id,
        rep_id=rep_id,
        branch_id=branch_id,
        reverses_entry_id=reverses_entry_id,
        entry_date=entry_date,
    )
    entry.lines = [
        LedgerLine(
            account_id=l.account_id,
            direction=l.direction,
            amount=to_money(l.amount),
            statement=l.statement,
            cost_center_id=l.cost_center_id,
        )
        for l in lines
    ]
    db.add(entry)
    db.flush()
    return entry


def reverse_entry(db: Session, *, original_id: int, actor_user_id: int) -> LedgerEntry:
    """Create the mirror reversal of an entry (debits<->credits swapped).

    Enforces reverse-once (UNIQUE reverses_entry_id) and that a reversal is not re-reversible.
    """
    original = db.get(LedgerEntry, original_id)
    if original is None:
        raise LedgerError("القيد الأصلي مش موجود.")
    # «العكس مرة واحدة» و«العكسي مايتعكسش» اتشالوا: التعديل والحذف بقوا بيمسحوا أثر
    # المستند بدل ما يكتبوا قيد مضاد (شوف `document_edit_service`)، فالعكس بقى حاجة
    # نادرة بيعملها حد قاصدها — والقاعدة اللي كانت بتحميه من نفسه بقت بتقف قدامه.

    swapped = [
        LineInput(
            account_id=line.account_id,
            direction=(
                Direction.credit if line.direction == Direction.debit else Direction.debit
            ),
            amount=line.amount,
            statement=line.statement,
            cost_center_id=line.cost_center_id,  # reversal nets within the same cost center (006)
        )
        for line in original.lines
    ]
    return post_entry(
        db,
        entry_type="reversal",
        actor_user_id=actor_user_id,
        lines=swapped,
        description=f"Reversal of entry {original_id}",
        rep_id=original.rep_id,
        branch_id=original.branch_id,
        reverses_entry_id=original_id,
        # Reversal nets in the original's accounting period (005 analysis finding A/C).
        entry_date=original.entry_date,
    )


def total_balance_of(db: Session, account_ids) -> Decimal:
    """The balances of many accounts, added up — in one query.

    `balance_of` loads every line of ONE account and sums them in Python, which is the right shape
    for one account and the wrong shape for all of them: totalling 233 customer accounts meant 233
    round trips and every ledger line in the system crossing the wire. Doing it twice inside the
    customer merge — once before and once after, to prove no money moved — took the request past
    the serverless timeout, and the merge came back 503 having done nothing.

    Same arithmetic, computed by the database: a line counts positive when its direction matches
    the account's normal side and negative when it does not.
    """
    ids = list(account_ids)
    if not ids:
        return ZERO
    signed = case(
        (LedgerLine.direction == Account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    total = db.scalar(
        select(func.coalesce(func.sum(signed), 0))
        .select_from(LedgerLine)
        .join(Account, Account.id == LedgerLine.account_id)
        .where(LedgerLine.account_id.in_(ids))
    )
    return to_money(total or 0)


def balance_of(db: Session, account_id: int) -> Decimal:
    """Derive an account's balance from its lines (signed by the account's normal side)."""
    account = db.get(Account, account_id)
    if account is None:
        raise LedgerError("الحساب مش موجود.")
    total = ZERO
    lines = db.scalars(select(LedgerLine).where(LedgerLine.account_id == account_id)).all()
    for line in lines:
        signed = (
            to_money(line.amount)
            if line.direction == account.normal_side
            else -to_money(line.amount)
        )
        total += signed
    return to_money(total)
