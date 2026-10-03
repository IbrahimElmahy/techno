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

import re
import unicodedata
from dataclasses import dataclass, field

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from src.models.customer import MERGED_MARK, Customer, CustomerAccount

# The prefix their system used to mark the second line. «تكنو» and «بولي» are the same thing to the
# client — the import carried the تكنو spelling, and the family it maps to is بولي.
TECHNO_PREFIX = "تكنو "
FAMILY_WHITE = "أبيض"
FAMILY_POLY = "بولي"

# «تكنو فلان» اللي مالوش «فلان» **مابيتسمّاش**. الاسم بتاعه عند a5 بـ«تكنو»، وأي
# مطابقة بعدين (كشف a5، ملف العميل، التزامن اليومي) بتدوّر عليه بالاسم ده. شيل البادئة
# كان بيكسر المطابقة دي كلها عشان تجميل. بيتقال في التقرير بس.
RENAME_TECHNO_ONLY = False


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


# الهمزات والتاء المربوطة والألف المقصورة. «تكنو اسامة ترابيس» عند a5 و«اسامه ترابيس»
# نفس الراجل بنفس المندوب — والمطابقة بالمسافات بس سابت ٣ أزواج من غير دمج على الإنتاج
# (ترابيس، عناني/عنانى، أبو/ابو كمال). المفتاح ده للمقارنة بس؛ الاسم المكتوب مابيتغيّرش.
_AR_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه",
                          "ـ": "", "\xa0": " "})


def match_key(name: str) -> str:
    s = unicodedata.normalize("NFKC", str(name or "")).translate(_AR_FOLD)
    s = "".join(c for c in s if not ("ً" <= c <= "ْ"))
    return " ".join(s.split()).casefold()


def _digits(phone: str | None) -> str:
    """آخر ١٠ أرقام — «+20 100…» و«0100…» نفس الرقم."""
    d = re.sub(r"\D", "", phone or "")
    return d[-10:] if len(d) >= 8 else ""


_MERGED_RX = re.compile(re.escape(MERGED_MARK) + r"(\d+)\)")


def merged_target_id(name: str | None) -> int | None:
    """الكارت اللي الكارت ده اندمج فيه، من العلامة على اسمه — أو None."""
    m = _MERGED_RX.search(name or "")
    return int(m.group(1)) if m else None


def final_targets(customers) -> dict[int, int]:
    """كل كارت مدموج → الكارت **الشغّال** اللي في آخر السلسلة.

    السلسلة (أ اندمج في ب، وب اندمج بعدين في ج) بتتمشي لآخرها؛ الحلقة أو هدف مش
    موجود بيرجع من غير هدف — المستورد بيفضل على الكارت الأصلي بدل ما يخمّن.
    """
    by_id = {c.id: c for c in customers}
    out: dict[int, int] = {}
    for c in by_id.values():
        t = merged_target_id(c.name)
        if t is None:
            continue
        seen = {c.id}
        final = None
        while t in by_id and t not in seen:
            seen.add(t)
            nxt = merged_target_id(by_id[t].name)
            if nxt is None:
                final = t
                break
            t = nxt
        if final is not None and by_id[final].active:
            out[c.id] = final
    return out


def plan(db: Session) -> MergePlan:
    """What `apply` would do. Reads only."""
    out = MergePlan()
    customers = db.scalars(select(Customer).where(Customer.active.is_(True))).all()

    # المفتاح (الفرع، الاسم) مش الاسم لوحده. «تكنو احمد صبرى» في العلياء كان بيلاقي
    # «احمد صبرى» في أكتوبر — راجل تاني بحساب تاني — والدمج كان هيحطّ رصيد فرع على
    # كارت فرع. الاسم بيتكرر بين الفرعين، والحساب لأ.
    by_name: dict[tuple[int | None, str], list[Customer]] = {}
    for c in customers:
        by_name.setdefault((c.branch_id, match_key(c.name)), []).append(c)
    families: dict[int, list[str | None]] = {}
    for cid, fam in db.execute(select(CustomerAccount.customer_id, CustomerAccount.family)):
        families.setdefault(cid, []).append(fam)

    for c in customers:
        name = _normalise(c.name)
        if not name.startswith(TECHNO_PREFIX):
            continue
        base = _normalise(name[len(TECHNO_PREFIX):])
        if not base:
            out.skipped.append((c.name, "«تكنو» من غير اسم بعدها"))
            continue

        candidates = by_name.get((c.branch_id, match_key(base)), [])
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
        # تليفونين مختلفين على الكارتين = احتمال راجلين بنفس الاسم. الاسم وحده مش دليل.
        p_keep, p_dupe = _digits(keep.phone), _digits(c.phone)
        if p_keep and p_dupe and p_keep != p_dupe:
            out.skipped.append(
                (c.name, f"تليفون مختلف عن «{keep.name}» ({keep.phone} / {c.phone})"))
            continue
        # الحساب اللي بيتنقل بيبقى «بولي» عند الباقي. لو الباقي عنده بولي بالفعل، أو المكرر
        # شايل أكتر من حساب، النقل بيقع على قيد التفرّد (customer_id, family) ويوقّع الدفعة كلها.
        keep_fams, dupe_fams = families.get(keep.id, []), families.get(c.id, [])
        if FAMILY_POLY in keep_fams:
            out.skipped.append((c.name, f"«{keep.name}» عنده حساب بولي بالفعل"))
            continue
        if len(dupe_fams) > 1 or any(f not in (None, FAMILY_POLY) for f in dupe_fams):
            fams = " / ".join(f or "-" for f in dupe_fams)
            out.skipped.append((c.name, f"المكرر عنده حسابات ({fams})"))
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


def apply(db: Session, *, dry_run: bool = True, limit: int | None = None,
          actor_user_id: int | None = None) -> dict:
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
    result["remaining"] = len(p.pairs) + (len(p.techno_only) if RENAME_TECHNO_ONLY else 0)
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
                                 "name": f"{dupe.name} {MERGED_MARK}{keep.id})"})
        moved[dupe.id] = keep.id

    renamed = 0
    if RENAME_TECHNO_ONLY:
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
            renamed += 1

    if account_changes:
        db.execute(update(CustomerAccount), account_changes)
    if customer_changes:
        db.execute(update(Customer), customer_changes)
    # التليفون والعنوان: الكارت الباقي بياخدهم من المكرر لو خانته فاضية بس.
    for dupe_id, keep_id in moved.items():
        db.execute(text(
            "UPDATE customer k SET phone = COALESCE(NULLIF(k.phone, ''), d.phone), "
            "address = COALESCE(NULLIF(k.address, ''), d.address) "
            "FROM customer d WHERE k.id = :keep AND d.id = :dupe"),
            {"keep": keep_id, "dupe": dupe_id})
    # الفاتورة اللي على «تكنو فلان» هي فاتورة الخط البولي — حسابها هو اللي بقى «بولي» عند
    # الباقي. من غير النوع، الفاتورة بتتنقل وتفضل «من غير نوع» جنب فواتيره الأبيض.
    families_tagged = tag_untagged_family(db, list(moved), FAMILY_POLY)
    documents_moved = _move_documents(db, moved)
    for pair in p.pairs:
        if pair.merge_customer_id in moved:
            _audit(db, actor_user_id, pair.merge_customer_id, pair.keep_customer_id,
                   pair.merge_name, pair.keep_name, kind="pair")

    # The session still holds the pre-update rows; a caller reading a balance straight afterwards
    # must see what the database now has, not what it had when this started.
    db.expire_all()
    done = p.as_dict()
    done["applied"] = True
    # What is LEFT after this batch — the caller repeats until it is zero.
    done["remaining"] = max(0, result["remaining"] - len(p.pairs) - renamed)
    done["merged_now"] = len(p.pairs) + renamed
    done["documents_moved"] = documents_moved
    done["families_tagged"] = families_tagged
    return done


# كل خانة بتشاور على العميل. القايمة مكتوبة بالاسم عن قصد: جدول جديد بيتضاف بعدين لازم
# حد ياخد باله ويحطه هنا، والبديل (اكتشاف المفاتيح وقت التشغيل) بينقل صفوف من غير ما حد
# قرر إنها تتنقل.
#
# (الجدول، العمود، شرط زيادة). كانت قايمة جداول بعمود `customer_id` بس، فكانت بتسيب على
# الكارت المقفول: `coupon_issue` (دفاتر الكوبونات)، `inspection.merchant_customer_id` (التاجر
# على المعاينة)، `customer_external_ref` (جسر أكواد ERP)، التليفونات الإضافية، وطرف القيد
# (`partner_id`) اللي التسوية وأعمار الديون بيقروا منه.
CUSTOMER_REFS: tuple[tuple[str, str, str], ...] = (
    ("sales_invoice", "customer_id", ""),
    ("sales_return", "customer_id", ""),
    ("voucher", "customer_id", ""),
    ("cheque", "customer_id", ""),
    ("trade_order", "customer_id", ""),
    ("reservation", "customer_id", ""),
    ("inspection", "customer_id", ""),
    ("inspection", "merchant_customer_id", ""),
    ("coupon", "customer_id", ""),
    ("coupon_issue", "customer_id", ""),
    ("coupon_receipt", "customer_id", ""),
    ("coupon_redemption", "customer_id", ""),
    ("point_record", "customer_id", ""),
    ("point_conversion", "customer_id", ""),
    ("customer_external_ref", "customer_id", ""),
    ("contact_phone", "owner_id", "owner_type = 'customer'"),
    ("ledger_line", "partner_id", "partner_kind = 'customer'"),
    # طرف القيد داخل في بصمة الدفتر المتجزّأ (`secure_hash_service.canonical_string`) —
    # القيد المتجزّأ بيفضل زي ما هو.
    ("ledger_entry", "partner_id", "partner_kind = 'customer' AND inalterable_hash IS NULL"),
)
# الاسم القديم — جداول `customer_id` بس.
DOCUMENT_TABLES = sorted({t for t, c, _ in CUSTOMER_REFS if c == "customer_id"})


def _existing_refs(db: Session) -> list[tuple[str, str, str]]:
    """الخانات الموجودة فعلاً في القاعدة دي — الستيجنج والإنتاج مش دايماً نفس السكيما.

    UPDATE على جدول مش موجود في Postgres بيوقّع الـtransaction كلها، مش السطر بس.
    """
    insp = sa_inspect(db.get_bind())
    tables = set(insp.get_table_names())
    cols: dict[str, set[str]] = {}
    out = []
    for t, c, extra in CUSTOMER_REFS:
        if t not in tables:
            continue
        if t not in cols:
            cols[t] = {x["name"] for x in insp.get_columns(t)}
        if c in cols[t]:
            out.append((t, c, extra))
    return out


def count_refs(db: Session, customer_ids) -> dict[int, dict[str, int]]:
    """كام صف بيشاور على كل كارت، خانة خانة — للتقرير قبل أي نقل."""
    ids = [int(i) for i in customer_ids]
    out: dict[int, dict[str, int]] = {i: {} for i in ids}
    if not ids:
        return out
    for t, c, extra in _existing_refs(db):
        where = f"{c} = ANY(:ids)" + (f" AND {extra}" if extra else "")
        for cid, n in db.execute(text(
                f"SELECT {c}, count(*) FROM {t} WHERE {where} GROUP BY {c}"), {"ids": ids}):
            out[int(cid)][f"{t}.{c}"] = int(n)
    return out


def tag_untagged_family(db: Session, customer_ids, family: str) -> dict[str, int]:
    """يحطّ النوع على فواتير ومرتجعات الكارت اللي مالهاش نوع — قبل ما تتنقل."""
    ids = [int(i) for i in customer_ids]
    out: dict[str, int] = {}
    if not ids:
        return out
    for t in ("sales_invoice", "sales_return"):
        n = db.execute(text(
            f"UPDATE {t} SET family = :f WHERE customer_id = ANY(:ids) AND family IS NULL"),
            {"f": family, "ids": ids}).rowcount or 0
        if n:
            out[t] = n
    return out


def _move_documents(db: Session, moved: dict[int, int]) -> dict[str, int]:
    """ينقل كل اللي بيشاور على العميل المكرر للعميل الباقي.

    من غير الخطوة دي الرصيد بيبقى صح والصفحة غلط: الفلوس على الحساب اللي اتنقل، والفواتير
    فاضلة على صف معطّل — فصفحة العميل بتوريه نص شغله.
    """
    if not moved:
        return {}
    out: dict[str, int] = {}
    for t, c, extra in _existing_refs(db):
        n = 0
        for dupe_id, keep_id in moved.items():
            res = db.execute(text(
                f"UPDATE {t} SET {c} = :keep WHERE {c} = :dupe"
                + (f" AND {extra}" if extra else "")
            ), {"keep": keep_id, "dupe": dupe_id})
            n += res.rowcount or 0
        if n:
            out[f"{t}.{c}"] = n
    return out


def _audit(db: Session, actor_user_id: int | None, dupe_id: int, keep_id: int,
           dupe_name: str, keep_name: str, *, kind: str) -> None:
    """صف في سجل التدقيق لكل دمج — مين اندمج في مين، عشان الرجوع يبقى ممكن."""
    from src.services import audit_service

    audit_service.record(
        db, action="customer.merge", actor_user_id=actor_user_id,
        entity_type="customer", entity_id=dupe_id,
        before={"id": dupe_id, "name": dupe_name},
        after={"merged_into": keep_id, "keep_name": keep_name, "kind": kind})


# ---------------------------------------------------------------------------
# بواقي الدمج: كارت اتقفل ولسه فيه حاجات بتشاور عليه.
#
# الدمج نقل المستندات اللي كانت موجودة ساعتها. بعده التزامن الليلي مع a5
# (`import_a5_docs`) كان بيلاقي العميل بكوده `AL-A5-<Cust_id>` — وكود «تكنو فلان» لسه على
# الكارت المقفول — فكل فاتورة بولي جديدة كانت بتنزل عليه، من غير نوع. الفلوس صح (القيد
# بيروح لحساب a5 اللي بقى بولي الباقي)، بس الفاتورة بتظهر باسم «تكنو فلان (مدموج في #…)»
# وصفحة العميل بتوريه نص شغله. ده بيلمّها.


@dataclass
class Leftover:
    dupe_id: int
    dupe_name: str
    keep_id: int | None
    keep_name: str | None
    refs: dict[str, int]
    accounts: int
    problem: str | None = None


def plan_leftovers(db: Session) -> list[Leftover]:
    """الكروت المتعلّمة «مدموج» اللي لسه في حاجة بتشاور عليها. بيقرا بس."""
    customers = db.scalars(select(Customer)).all()
    by_id = {c.id: c for c in customers}
    targets = final_targets(customers)
    merged = [c for c in customers if MERGED_MARK in (c.name or "")]
    refs = count_refs(db, [c.id for c in merged])
    accs: dict[int, int] = {}
    for (cid,) in db.execute(select(CustomerAccount.customer_id).where(
            CustomerAccount.customer_id.in_([c.id for c in merged] or [0]))):
        accs[cid] = accs.get(cid, 0) + 1
    out: list[Leftover] = []
    for c in merged:
        r = {k: v for k, v in refs.get(c.id, {}).items() if v}
        if not r and not accs.get(c.id) and not c.active:
            continue
        t = targets.get(c.id)
        keep = by_id.get(t) if t else None
        problem = None
        if keep is None:
            problem = f"الهدف #{merged_target_id(c.name)} مش موجود أو مش شغّال أو السلسلة مقفولة"
        elif keep.branch_id != c.branch_id:
            problem = "الهدف في فرع تاني"
        elif accs.get(c.id):
            # حساب لسه على الكارت المقفول = الدمج نفسه ماكملش. ده مش بواقي مستندات،
            # ونقله أوتوماتيك ممكن يقع على قيد (customer_id, family).
            problem = f"لسه عليه {accs[c.id]} حساب ذمم — محتاج دمج حقيقي"
        elif c.active:
            problem = "متعلّم مدموج بس لسه شغّال"
        out.append(Leftover(c.id, c.name, keep.id if keep else None,
                            keep.name if keep else None, r, accs.get(c.id, 0), problem))
    out.sort(key=lambda x: x.dupe_id)
    return out


def apply_leftovers(db: Session, *, actor_user_id: int | None = None,
                    dry_run: bool = True) -> dict:
    """ينقل البواقي للكارت الشغّال اللي في آخر السلسلة. `dry_run` افتراضي."""
    items = plan_leftovers(db)
    ok = [x for x in items if x.problem is None and x.keep_id is not None]
    result: dict = {"leftovers": len(ok),
                    "problems": [(x.dupe_id, x.dupe_name, x.problem) for x in items if x.problem]}
    if dry_run or not ok:
        result["applied"] = False
        return result
    moved = {x.dupe_id: x.keep_id for x in ok}
    # الكروت دي اتقفلت كخط بولي (حسابها بقى «بولي» عند الباقي) — فالفاتورة اللي عليها بولي.
    poly = [x.dupe_id for x in ok if _normalise(x.dupe_name).startswith(TECHNO_PREFIX)]
    result["families_tagged"] = tag_untagged_family(db, poly, FAMILY_POLY)
    result["moved"] = _move_documents(db, moved)
    for x in ok:
        _audit(db, actor_user_id, x.dupe_id, x.keep_id, x.dupe_name, x.keep_name or "",
               kind="leftover")
    db.expire_all()
    result["applied"] = True
    return result


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
        # مالوش حساب بالاسم ده — بس عنده حساب واحد بس، فمافيش لبس أصلاً.
        #
        # «نوع الفاتورة» سؤالين في واحد: خط المنتجات اللي الفاتورة عليه (بيتكتب على
        # المستند)، والحساب اللي بتترحّل عليه. للعميل المقسوم هما نفس السؤال؛ للعميل
        # العادي (حساب واحد بـfamily=null) الأول له معنى والتاني مالوش غير إجابة واحدة.
        # الرفض هنا كان بيوقّع فاتورة اتكتبت كاملة عشان البايع اختار «أبيض» — والفلوس
        # مالهاش غير مكان واحد تروح له بأي حال.
        if len(rows) == 1:
            return rows[0]
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
