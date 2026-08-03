"""دمج «تكنو فلان» مع «فلان» تحت عميل واحد بحسابين — 031-a5-restructure.

The client's old system could give a customer only one receivable account, so selling him two
product lines at two commissions meant opening him twice: «محمد عامر» for أبيض and «تكنو محمد عامر»
for بولي. That import came across as 230 customers where there are 144 people.

This puts them back together: one customer, two family accounts under him, and a total.

**Nothing is deleted.** The duplicate's LEDGER ACCOUNT is what carries his history — every invoice,
voucher and opening balance posted against it stays exactly where it is, and the account simply
becomes the بولي account of the surviving customer. The duplicate customer ROW is deactivated, not
removed, so a document that names it still resolves to a name rather than to a dangling id.

That is the whole safety argument: merging moves a pointer, it does not move money. The balances
after a merge are the same two numbers as before, now with a place to be added up.

**Dry run first.** `plan()` reports exactly what `apply()` would do and touches nothing. A merge is
not something to discover the shape of by running it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.customer import Customer, CustomerAccount

# The prefix their system used to mark the second line. «تكنو» and «بولي» are the same thing to the
# client — the import carried the تكنو spelling, and the family it maps to is بولي.
TECHNO_PREFIX = "تكنو "
FAMILY_WHITE = "أبيض"
FAMILY_POLY = "بولي"


class MergeError(Exception):
    pass


@dataclass
class MergePair:
    """One person found under two names."""
    base_name: str
    keep_customer_id: int
    keep_name: str
    merge_customer_id: int
    merge_name: str
    same_rep: bool


@dataclass
class MergePlan:
    pairs: list[MergePair] = field(default_factory=list)
    # Named «تكنو X» with no plain «X» to join. Renamed rather than merged: the person exists, he
    # simply has one line, and leaving «تكنو» in his name would keep a filing convention that has
    # stopped meaning anything.
    techno_only: list[tuple[int, str]] = field(default_factory=list)
    # Skipped, with the reason. A pair the code will not touch must SAY so — a silent skip in a
    # merge is indistinguishable from a merge that quietly did nothing.
    skipped: list[tuple[str, str]] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "pairs": [
                {"base_name": p.base_name,
                 "keep": {"id": p.keep_customer_id, "name": p.keep_name},
                 "merge": {"id": p.merge_customer_id, "name": p.merge_name},
                 "same_rep": p.same_rep}
                for p in self.pairs],
            "techno_only": [{"id": i, "name": n} for i, n in self.techno_only],
            "skipped": [{"name": n, "reason": r} for n, r in self.skipped],
            "totals": {"pairs": len(self.pairs), "techno_only": len(self.techno_only),
                       "skipped": len(self.skipped)},
        }


def _normalise(name: str) -> str:
    """Compare names the way a person would.

    The workbook was typed by hand over years: «احمد  جمعه» with two spaces is the same man as
    «احمد جمعه». Matching on the raw string would leave those pairs unmerged and report success.
    """
    return " ".join(str(name or "").split())


def plan(db: Session) -> MergePlan:
    """What `apply` would do. Reads only."""
    out = MergePlan()
    customers = db.scalars(select(Customer).where(Customer.active.is_(True))).all()

    by_name: dict[str, list[Customer]] = {}
    for c in customers:
        by_name.setdefault(_normalise(c.name), []).append(c)

    for c in customers:
        name = _normalise(c.name)
        if not name.startswith(TECHNO_PREFIX):
            continue
        base = _normalise(name[len(TECHNO_PREFIX):])
        if not base:
            out.skipped.append((c.name, "«تكنو» من غير اسم بعدها"))
            continue

        candidates = by_name.get(base, [])
        if not candidates:
            out.techno_only.append((c.id, c.name))
            continue
        if len(candidates) > 1:
            # Two people share the plain name — usually the same account on both reps. Guessing
            # which one the تكنو row belongs to would put a balance on the wrong person's card.
            out.skipped.append((c.name, f"«{base}» متكرر {len(candidates)} مرات — محتاج قرار"))
            continue

        keep = candidates[0]
        if keep.id == c.id:
            continue
        out.pairs.append(MergePair(
            base_name=base,
            keep_customer_id=keep.id, keep_name=keep.name,
            merge_customer_id=c.id, merge_name=c.name,
            same_rep=keep.rep_id == c.rep_id,
        ))

    out.pairs.sort(key=lambda p: p.base_name)
    out.techno_only.sort(key=lambda t: t[1])
    return out


def apply(db: Session, *, dry_run: bool = True) -> dict:
    """Perform the merge. `dry_run=True` (the default) reports and changes nothing.

    Defaulted to a dry run on purpose: the dangerous call should be the one you have to ask for.
    """
    p = plan(db)
    result = p.as_dict()
    result["applied"] = False
    if dry_run:
        return result

    for pair in p.pairs:
        keep = db.get(Customer, pair.keep_customer_id)
        dupe = db.get(Customer, pair.merge_customer_id)
        if keep is None or dupe is None:      # planned then vanished — say so, do not guess
            p.skipped.append((pair.merge_name, "العميل اختفى بين التخطيط والتنفيذ"))
            continue

        # The surviving customer's own account becomes the أبيض one; the duplicate's account moves
        # across as بولي, carrying its whole ledger history with it untouched.
        for acc in db.scalars(select(CustomerAccount).where(
                CustomerAccount.customer_id == keep.id)).all():
            if acc.family is None:
                acc.family = FAMILY_WHITE
        for acc in db.scalars(select(CustomerAccount).where(
                CustomerAccount.customer_id == dupe.id)).all():
            acc.customer_id = keep.id
            acc.family = FAMILY_POLY

        # Deactivated, never deleted: documents already name this row, and a deleted customer turns
        # every one of them into an id nobody can resolve.
        dupe.active = False
        dupe.name = f"{dupe.name} (مدموج في #{keep.id})"

    for cid, name in p.techno_only:
        c = db.get(Customer, cid)
        if c is None:
            continue
        c.name = _normalise(name[len(TECHNO_PREFIX):])
        for acc in db.scalars(select(CustomerAccount).where(
                CustomerAccount.customer_id == c.id)).all():
            if acc.family is None:
                acc.family = FAMILY_POLY

    db.flush()
    result = p.as_dict()
    result["applied"] = True
    return result
