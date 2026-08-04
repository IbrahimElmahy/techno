"""ترقيم المستندات — رقم واحد جديد، مهما اتمسح إيه.

Every document type in this system numbered itself by COUNTING its rows:

    n = select(count()).select_from(Model)
    return f"SINV-{n + 1:06d}"

Which is right exactly until a row goes away. Delete one document of eight and the count says
seven, so the next one is offered `-000008` — a number that already exists. `document_number` is
UNIQUE, so the insert fails and the user is told nothing useful; they simply cannot save, and
cannot save the next one either, because the count is stuck one behind forever.

Proven on a scratch database before this was written: three receipts, delete the middle one, and
the next number offered is the one still sitting on the third.

Counting is also wrong under two people saving at once — both read the same count and one loses —
but the deletion case is the one that bites without any concurrency at all.

**The rule here is the highest number ever ISSUED, plus one.** Read off the existing document
numbers rather than off the row count, so a gap left by a deletion stays a gap. That is also the
honest behaviour for an accounting document: a missing number is a question somebody should be
able to ask, and reusing it erases the question.
"""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session


def next_document_number(db: Session, model, prefix: str, *, where=None) -> str:
    """The next `PREFIX-000001`-style number for `model`.

    `where` narrows the series — vouchers share a table and number per kind, so a receipt and a
    payment each count from one.
    """
    column = model.document_number
    stmt = select(column).where(column.like(f"{prefix}-%"))
    if where is not None:
        stmt = stmt.where(where)

    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    highest = 0
    for (value,) in db.execute(stmt):
        m = pattern.match(value or "")
        if m:
            # Ignoring anything that does not match the shape rather than failing on it: a number
            # edited by hand, or carried in from the old system, should not stop new ones being
            # issued.
            highest = max(highest, int(m.group(1)))
    return f"{prefix}-{highest + 1:06d}"
