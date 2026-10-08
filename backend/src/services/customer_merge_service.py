from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from src.models.customer import MERGED_MARK, Customer, CustomerAccount

TECHNO_PREFIX = "تكنو "
FAMILY_WHITE = "أبيض"
FAMILY_POLY = "بولي"

RENAME_TECHNO_ONLY = False


class MergeError(Exception):
    pass


@dataclass
class MergePair:
    base_name: str
    keep_customer_id: int
    keep_name: str
    merge_customer_id: int
    merge_name: str
    same_rep: bool


@dataclass
class MergePlan:
    pairs: list[MergePair] = field(default_factory=list)
    techno_only: list[tuple[int, str]] = field(default_factory=list)
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
    return " ".join(str(name or "").split())


_AR_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه",
                          "ـ": "", "\xa0": " "})


def match_key(name: str) -> str:
    s = unicodedata.normalize("NFKC", str(name or "")).translate(_AR_FOLD)
    s = "".join(c for c in s if not ("ً" <= c <= "ْ"))
    return " ".join(s.split()).casefold()


def _digits(phone: str | None) -> str:
    d = re.sub(r"\D", "", phone or "")
    return d[-10:] if len(d) >= 8 else ""


_MERGED_RX = re.compile(re.escape(MERGED_MARK) + r"(\d+)\)")


def merged_target_id(name: str | None) -> int | None:
    m = _MERGED_RX.search(name or "")
    return int(m.group(1)) if m else None


def final_targets(customers) -> dict[int, int]:
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
    out = MergePlan()
    customers = db.scalars(select(Customer).where(Customer.active.is_(True))).all()

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
            out.skipped.append((c.name, f"«{base}» متكرر {len(candidates)} مرات — محتاج قرار"))
            continue

        keep = candidates[0]
        if keep.id == c.id:
            continue
        p_keep, p_dupe = _digits(keep.phone), _digits(c.phone)
        if p_keep and p_dupe and p_keep != p_dupe:
            out.skipped.append(
                (c.name, f"تليفون مختلف عن «{keep.name}» ({keep.phone} / {c.phone})"))
            continue
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
    p = plan(db)
    result = p.as_dict()
    result["applied"] = False
    result["remaining"] = len(p.pairs) + (len(p.techno_only) if RENAME_TECHNO_ONLY else 0)
    if dry_run:
        return result

    if limit is not None:
        p.pairs = p.pairs[:limit]
        p.techno_only = p.techno_only[:max(0, limit - len(p.pairs))]

    accounts_by_customer: dict[int, list[CustomerAccount]] = {}
    for acc in db.scalars(select(CustomerAccount)).all():
        accounts_by_customer.setdefault(acc.customer_id, []).append(acc)

    wanted = {pid for pair in p.pairs for pid in (pair.keep_customer_id, pair.merge_customer_id)}
    wanted.update(cid for cid, _ in p.techno_only)
    customers = {c.id: c for c in db.scalars(
        select(Customer).where(Customer.id.in_(wanted)))} if wanted else {}

    account_changes: list[dict] = []
    customer_changes: list[dict] = []
    moved: dict[int, int] = {}

    for pair in p.pairs:
        keep = customers.get(pair.keep_customer_id)
        dupe = customers.get(pair.merge_customer_id)
        if keep is None or dupe is None:
            p.skipped.append((pair.merge_name, "العميل اختفى بين التخطيط والتنفيذ"))
            continue

        for acc in accounts_by_customer.get(keep.id, []):
            if acc.family is None:
                account_changes.append({"id": acc.id, "customer_id": keep.id,
                                        "family": FAMILY_WHITE})
        for acc in accounts_by_customer.get(dupe.id, []):
            account_changes.append({"id": acc.id, "customer_id": keep.id,
                                    "family": FAMILY_POLY})

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
    for dupe_id, keep_id in moved.items():
        db.execute(text(
            "UPDATE customer k SET phone = COALESCE(NULLIF(k.phone, ''), d.phone), "
            "address = COALESCE(NULLIF(k.address, ''), d.address) "
            "FROM customer d WHERE k.id = :keep AND d.id = :dupe"),
            {"keep": keep_id, "dupe": dupe_id})
    families_tagged = tag_untagged_family(db, list(moved), FAMILY_POLY)
    documents_moved = _move_documents(db, moved)
    for pair in p.pairs:
        if pair.merge_customer_id in moved:
            _audit(db, actor_user_id, pair.merge_customer_id, pair.keep_customer_id,
                   pair.merge_name, pair.keep_name, kind="pair")

    db.expire_all()
    done = p.as_dict()
    done["applied"] = True
    done["remaining"] = max(0, result["remaining"] - len(p.pairs) - renamed)
    done["merged_now"] = len(p.pairs) + renamed
    done["documents_moved"] = documents_moved
    done["families_tagged"] = families_tagged
    return done


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
    ("ledger_entry", "partner_id", "partner_kind = 'customer' AND inalterable_hash IS NULL"),
)
DOCUMENT_TABLES = sorted({t for t, c, _ in CUSTOMER_REFS if c == "customer_id"})


def _existing_refs(db: Session) -> list[tuple[str, str, str]]:
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
    from src.services import audit_service

    audit_service.record(
        db, action="customer.merge", actor_user_id=actor_user_id,
        entity_type="customer", entity_id=dupe_id,
        before={"id": dupe_id, "name": dupe_name},
        after={"merged_into": keep_id, "keep_name": keep_name, "kind": kind})


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
            problem = f"لسه عليه {accs[c.id]} حساب ذمم — محتاج دمج حقيقي"
        elif c.active:
            problem = "متعلّم مدموج بس لسه شغّال"
        out.append(Leftover(c.id, c.name, keep.id if keep else None,
                            keep.name if keep else None, r, accs.get(c.id, 0), problem))
    out.sort(key=lambda x: x.dupe_id)
    return out


def apply_leftovers(db: Session, *, actor_user_id: int | None = None,
                    dry_run: bool = True) -> dict:
    items = plan_leftovers(db)
    ok = [x for x in items if x.problem is None and x.keep_id is not None]
    result: dict = {"leftovers": len(ok),
                    "problems": [(x.dupe_id, x.dupe_name, x.problem) for x in items if x.problem]}
    if dry_run or not ok:
        result["applied"] = False
        return result
    moved = {x.dupe_id: x.keep_id for x in ok}
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
    rows = db.scalars(select(CustomerAccount).where(
        CustomerAccount.customer_id == customer_id)).all()
    if not rows:
        return None
    if family is not None:
        for a in rows:
            if a.family == family:
                return a
        if len(rows) == 1:
            return rows[0]
        raise MergeError(f"العميل مالوش حساب لـ«{family}»")
    if len(rows) == 1:
        return rows[0]
    for a in rows:
        if a.family is None:
            return a
    names = " / ".join(a.family or "-" for a in rows)
    raise MergeError(f"العميل عنده أكتر من حساب ({names}) — لازم تحدد النوع")
