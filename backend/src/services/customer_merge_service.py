"""دمج «تكنو فلان» مع «فلان» تحت عميل واحد بحسابين — 031-a5-restructure.

The client's old system could give a customer only one receivable account, so selling him two
product lines at two commissions meant opening him twice: «محمد عامر» for أبيض and «تكنو محمد عامر»
for بولي. That import came across as 230 customers where there are 144 people.

This puts them back together: one customer, two family accounts under him, and a total.

**Nothing is deleted.** The duplicate's LEDGER ACCOUNT is what carries his history — every invoice,
voucher and opening balance posted against it stays exactly where it is, and the account simply
becomes the بولي account of the surviving customer. The duplicate customer ROW is deactivated, not
removed, so a document that names it still resolves to a name rather than to a dangling id.

**والمستندات بتتنقل للعميل الباقي.** كانت بتتساب على الصف المعطّل: الرصيد بيبقى صح (لأنه على
الحساب اللي اتنقل) بس صفحة العميل بتوريه نص فواتيره، والنص التاني على اسم «تكنو فلان (مدموج
في #123)». الفاتورة نفسها شايلة عائلتها، فنقلها للعميل الموحّد مابيضيّعش على أنهي خط اتباعت.

That is the whole safety argument: merging moves a pointer, it does not move money. The balances
after a merge are the same two numbers as before, now with a place to be added up.

**Dry run first.** `plan()` reports exactly what `apply()` would do and touches nothing. A merge is
not something to discover the shape of by running it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select, text, update
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


def apply(db: Session, *, dry_run: bool = True, limit: int | None = None) -> dict:
    """Perform the merge. `dry_run=True` (the default) reports and changes nothing.

    Defaulted to a dry run on purpose: the dangerous call should be the one you have to ask for.

    **`limit` merges only that many pairs and says how many are left.** The whole set is 86 people
    on the client's data, and doing them in one request kept coming back 503 from a platform that
    caps how long a request may run — a cap this cannot see and should not have to guess at. Run in
    batches it does not matter what the cap is: each call is short, and the caller repeats until
    `remaining` reaches zero.

    Batching is safe here because a merge is per-customer and independent. Twenty done and sixty
    left is not a half-finished state — it is sixty people who have not been merged yet, which is
    exactly where they started.
    """
    p = plan(db)
    result = p.as_dict()
    result["applied"] = False
    result["remaining"] = len(p.pairs) + len(p.techno_only)
    if dry_run:
        return result

    # Take a slice of the work; the rest stays exactly as it was for the next call.
    if limit is not None:
        p.pairs = p.pairs[:limit]
        p.techno_only = p.techno_only[:max(0, limit - len(p.pairs))]

    # Every customer account, once, grouped in memory.
    #
    # This used to run two `SELECT ... WHERE customer_id = ?` per pair — 86 pairs plus 19 renames
    # is over 190 round trips to a database that is not on the same machine. Against a serverless
    # function with a hard time limit that is not slow, it is a failure: the merge answered 503
    # having done nothing. The mutations below are unchanged; only the fetching is.
    accounts_by_customer: dict[int, list[CustomerAccount]] = {}
    for acc in db.scalars(select(CustomerAccount)).all():
        accounts_by_customer.setdefault(acc.customer_id, []).append(acc)

    # The customers too, in one query rather than a `get` per side per pair. `get` hits the identity
    # map when the row is already loaded and the database when it is not, and «not» is the case that
    # decides whether this finishes inside the time limit.
    wanted = {pid for pair in p.pairs for pid in (pair.keep_customer_id, pair.merge_customer_id)}
    wanted.update(cid for cid, _ in p.techno_only)
    customers = {c.id: c for c in db.scalars(
        select(Customer).where(Customer.id.in_(wanted)))} if wanted else {}

    # The changes are COLLECTED, then written in three statements.
    #
    # Setting them one attribute at a time leaves the flush with roughly three UPDATEs per pair —
    # 260 for the client's 86 duplicates — and each is a round trip. That is what was still timing
    # out after the reads were fixed: the plan came back in a moment and the apply died at 503.
    #
    # `execute(update(Model), [rows])` sends one statement with many parameter sets, so the count
    # stops depending on how many customers are being merged. The decisions below are exactly the
    # ones the loop made; only the moment of writing moved.
    account_changes: list[dict] = []
    customer_changes: list[dict] = []
    # المكرر → الباقي. المستندات بتتنقل عليها بعد ما الحسابات تتحرّك.
    moved: dict[int, int] = {}

    for pair in p.pairs:
        keep = customers.get(pair.keep_customer_id)
        dupe = customers.get(pair.merge_customer_id)
        if keep is None or dupe is None:      # planned then vanished — say so, do not guess
            p.skipped.append((pair.merge_name, "العميل اختفى بين التخطيط والتنفيذ"))
            continue

        # The surviving customer's own account becomes the أبيض one; the duplicate's account moves
        # across as بولي, carrying its whole ledger history with it untouched.
        for acc in accounts_by_customer.get(keep.id, []):
            if acc.family is None:
                account_changes.append({"id": acc.id, "customer_id": keep.id,
                                        "family": FAMILY_WHITE})
        for acc in accounts_by_customer.get(dupe.id, []):
            account_changes.append({"id": acc.id, "customer_id": keep.id,
                                    "family": FAMILY_POLY})

        # Deactivated, never deleted: documents already name this row, and a deleted customer turns
        # every one of them into an id nobody can resolve.
        customer_changes.append({"id": dupe.id, "active": False,
                                 "name": f"{dupe.name} (مدموج في #{keep.id})"})
        moved[dupe.id] = keep.id

    for cid, name in p.techno_only:
        c = customers.get(cid)
        if c is None:
            continue
        customer_changes.append({"id": c.id, "active": c.active,
                                 "name": _normalise(name[len(TECHNO_PREFIX):])})
        for acc in accounts_by_customer.get(c.id, []):
            if acc.family is None:
                account_changes.append({"id": acc.id, "customer_id": c.id,
                                        "family": FAMILY_POLY})

    if account_changes:
        db.execute(update(CustomerAccount), account_changes)
    if customer_changes:
        db.execute(update(Customer), customer_changes)
    documents_moved = _move_documents(db, moved)

    # The session still holds the pre-update rows; a caller reading a balance straight afterwards
    # must see what the database now has, not what it had when this started.
    db.expire_all()
    done = p.as_dict()
    done["applied"] = True
    # What is LEFT after this batch — the caller repeats until it is zero.
    done["remaining"] = max(0, result["remaining"] - len(p.pairs) - len(p.techno_only))
    done["merged_now"] = len(p.pairs) + len(p.techno_only)
    done["documents_moved"] = documents_moved
    return done


# كل جدول بيشاور على العميل. القايمة مكتوبة بالاسم عن قصد: جدول جديد بيتضاف بعدين لازم
# حد ياخد باله ويحطه هنا، والبديل (اكتشاف المفاتيح وقت التشغيل) بينقل صفوف من غير ما حد
# قرر إنها تتنقل.
DOCUMENT_TABLES = [
    "sales_invoice", "sales_return", "voucher", "cheque", "trade_order",
    "reservation", "inspection", "coupon", "coupon_receipt", "coupon_redemption",
    "point_record", "point_conversion",
]


def _move_documents(db: Session, moved: dict[int, int]) -> dict[str, int]:
    """ينقل مستندات العميل المكرر للعميل الباقي.

    من غير الخطوة دي الرصيد بيبقى صح والصفحة غلط: الفلوس على الحساب اللي اتنقل، والفواتير
    فاضلة على صف معطّل — فصفحة العميل بتوريه نص شغله.
    """
    if not moved:
        return {}
    out: dict[str, int] = {}
    for table in DOCUMENT_TABLES:
        n = 0
        for dupe_id, keep_id in moved.items():
            res = db.execute(text(
                f"UPDATE {table} SET customer_id = :keep WHERE customer_id = :dupe"
            ), {"keep": keep_id, "dupe": dupe_id})
            n += res.rowcount or 0
        if n:
            out[table] = n
    return out


def receivable_account(db: Session, customer_id: int, family: str | None = None):
    """حساب المدينين اللي الحركة دي بتترحّل عليه.

    A customer used to have exactly one, so every caller wrote
    `db.scalar(select(CustomerAccount).where(customer_id == X))` and was right. Once he can hold
    one per product line, that same query returns **an arbitrary one of them** — silently, and
    possibly a different one between two runs. Money would land on the wrong line's balance and
    nothing anywhere would say so.

    So the rule is written once, here:

    * a family given → that family's account;
    * no family, and he holds exactly one account → that one (every customer who was never split);
    * no family, and he holds several → **refuse**. There is no honest answer, and guessing puts a
      sale on «أبيض» that belonged to «بولي» with no trace of the decision.
    """
    rows = db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == customer_id)).all()
    if not rows:
        return None
    if family is not None:
        for a in rows:
            if a.family == family:
                return a
        raise MergeError(f"العميل مالوش حساب لـ«{family}»")
    if len(rows) == 1:
        return rows[0]
    # The family-less account still exists on a customer who was never merged but somehow gained a
    # family account — take it, since it is unambiguously «his one account».
    for a in rows:
        if a.family is None:
            return a
    names = " / ".join(a.family or "-" for a in rows)
    raise MergeError(f"العميل عنده أكتر من حساب ({names}) — لازم تحدد النوع")
