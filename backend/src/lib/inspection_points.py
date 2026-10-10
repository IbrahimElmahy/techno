from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import String, and_, case, cast, func, literal, or_, select
from sqlalchemy.orm import Session, aliased

from src.core.money import to_qty
from src.lib import arabic
from src.lib import multi_filter as mf
from src.models.customer import Customer
from src.models.inspection import Inspection, InspectionItem, InspectionStatus, VisitKind
from src.models.org import Branch, Governorate
from src.models.user import User

DIMENSIONS = ("document", "item", "technician", "merchant", "rep", "visit_kind", "month",
              "day", "governorate", "markaz", "branch")
PERIODS = ("month", "day")
VISIT_KIND_LABELS = {"technician": "معاينة فني", "regular": "زيارة عادية"}
EMPTY_LABELS = {"technician": "بدون فني", "merchant": "بدون تاجر", "rep": "بدون مندوب",
                "governorate": "بدون محافظة", "markaz": "بدون مركز", "branch": "بدون فرع",
                "item": "بدون صنف", "visit_kind": "غير محدد"}

MAX_ROWS = 20000


class InspectionPointsError(Exception):
    pass


def counted_visit():
    return Inspection.status != InspectionStatus.rejected


def plumbers_by_name():
    return (select(Customer.name.label("name"), func.min(Customer.id).label("id"))
            .where(Customer.customer_type == "plumber")
            .group_by(Customer.name).subquery("pn"))


def user_name(user):
    return func.coalesce(func.nullif(user.full_name, ""), user.username)


def _text_variants(value: str) -> set[str]:
    value = value.strip()
    return {value, arabic.western_digits(value) or value, arabic.eastern_digits(value) or value}


def analyse(
    db: Session,
    *,
    dims: list[str] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    branch_id=None,
    rep_id=None,
    technician_id=None,
    technician_name: str | None = None,
    merchant_id=None,
    item=None,
    visit_kind=None,
    governorate_id=None,
) -> dict:
    dims = [d for d in (dims or []) if d]
    bad = [d for d in dims if d not in DIMENSIONS]
    if bad:
        raise InspectionPointsError(f"بعد غير معروف: {', '.join(bad)}")
    if len(dims) != len(set(dims)):
        raise InspectionPointsError("لا يجوز تكرار نفس البعد")
    branch_ids, rep_ids, technician_ids = mf.ids(branch_id), mf.ids(rep_id), mf.ids(technician_id)
    merchant_ids, governorate_ids = mf.ids(merchant_id), mf.ids(governorate_id)
    item_names, visit_kinds = mf.strs(item, "|"), mf.strs(visit_kind)
    if visit_kinds and any(v not in VISIT_KIND_LABELS for v in visit_kinds):
        raise InspectionPointsError("نوع الزيارة غير معروف")

    i, ln = Inspection, InspectionItem
    pn = plumbers_by_name()
    tech = aliased(Customer, name="tech")
    merchant = aliased(Customer, name="merchant")
    rep = aliased(User, name="rep")
    tech_rep = aliased(User, name="tech_rep")

    tech_id = func.coalesce(i.customer_id, pn.c.id)
    tech_label = func.coalesce(tech.name, i.technician_name)
    tech_loose = case((tech_id.is_(None), i.technician_name))
    tech_phone = func.coalesce(tech.phone, i.technician_phone)
    merchant_loose = case((i.merchant_customer_id.is_(None), i.purchase_shop))
    merchant_label = func.coalesce(merchant.name, i.purchase_shop)

    keys: dict[str, tuple] = {
        "document": (i.id,),
        "item": (ln.item_name,),
        "technician": (tech_id, tech_loose),
        "merchant": (i.merchant_customer_id, merchant_loose),
        "rep": (i.rep_user_id,),
        "visit_kind": (i.visit_kind,),
        "month": (func.date_trunc("month", i.inspection_date),),
        "day": (i.inspection_date,),
        "governorate": (tech.governorate_id,),
        "markaz": (tech.markaz,),
        "branch": (i.branch_id,),
    }
    extras: dict[str, dict] = {
        "document": {"document": i.document_number, "document_date": i.inspection_date,
                     "document_kind": i.visit_kind, "document_type": i.inspection_type,
                     "document_owner": i.owner_name, "document_shop": i.purchase_shop},
        "item": {"item_points": ln.points},
        "technician": {"technician": tech_label, "technician_code": tech.code,
                       "technician_phone": tech_phone, "technician_markaz": tech.markaz,
                       "technician_governorate": Governorate.name,
                       "technician_rep": user_name(tech_rep)},
        "merchant": {"merchant": merchant_label, "merchant_code": merchant.code,
                     "merchant_phone": merchant.phone},
        "rep": {"rep": user_name(rep)},
        "governorate": {"governorate": Governorate.name},
        "branch": {"branch": Branch.name},
    }
    if "document" in dims:
        doc_extra = extras["document"]
        if "technician" not in dims:
            doc_extra.update({"technician": tech_label, "technician_phone": tech_phone})
        if "merchant" not in dims:
            doc_extra["merchant"] = merchant_label
        if "rep" not in dims:
            doc_extra["rep"] = user_name(rep)

    measures = {
        "qty": func.coalesce(func.sum(ln.quantity), 0),
        "points": func.coalesce(func.sum(ln.total), 0),
        "visits": func.count(func.distinct(i.id)),
        "technicians": func.count(func.distinct(func.coalesce(
            cast(tech_id, String), literal("n:") + i.technician_name))),
        "items": func.count(func.distinct(ln.item_name)),
    }

    def base(*cols):
        stmt = (select(*cols).select_from(ln)
                .join(i, i.id == ln.inspection_id)
                .outerjoin(pn, and_(i.customer_id.is_(None), pn.c.name == i.technician_name))
                .outerjoin(tech, tech.id == tech_id)
                .outerjoin(merchant, merchant.id == i.merchant_customer_id)
                .outerjoin(rep, rep.id == i.rep_user_id)
                .outerjoin(tech_rep, tech_rep.id == func.coalesce(tech.service_rep_id, tech.rep_id))
                .outerjoin(Governorate, Governorate.id == tech.governorate_id)
                .outerjoin(Branch, Branch.id == i.branch_id)
                .where(counted_visit()))
        if date_from:
            stmt = stmt.where(i.inspection_date >= date_from)
        if date_to:
            stmt = stmt.where(i.inspection_date <= date_to)
        if branch_ids:
            stmt = stmt.where(or_(i.branch_id.in_(branch_ids), i.branch_id.is_(None)))
        if rep_ids:
            stmt = stmt.where(i.rep_user_id.in_(rep_ids))
        if technician_ids:
            stmt = stmt.where(tech_id.in_(technician_ids))
        if technician_name:
            stmt = stmt.where(i.technician_name == technician_name.strip())
        if merchant_ids:
            stmt = stmt.where(i.merchant_customer_id.in_(merchant_ids))
        if item_names:
            stmt = stmt.where(ln.item_name.in_(set().union(*(_text_variants(n) for n in item_names))))
        if visit_kinds:
            stmt = stmt.where(i.visit_kind.in_([VisitKind(v) for v in visit_kinds]))
        if governorate_ids:
            stmt = stmt.where(tech.governorate_id.in_(governorate_ids))
        return stmt

    cols, group = [], []
    for d in dims:
        for n, k in enumerate(keys[d]):
            cols.append(k.label(f"{d}__k{n}"))
            group.append(k)
        for name, expr in extras.get(d, {}).items():
            cols.append(func.max(expr).label(name))
    stmt = base(*cols, *(m.label(name) for name, m in measures.items()))
    if group:
        stmt = stmt.group_by(*group)
    raw = db.execute(stmt.limit(MAX_ROWS + 1)).mappings().all()
    truncated = len(raw) > MAX_ROWS
    raw = raw[:MAX_ROWS]
    totals_raw = db.execute(base(*(m.label(name) for name, m in measures.items()))).mappings().one()

    extra_names = {name for d in dims for name in extras.get(d, {})}
    rows = []
    for r in raw:
        out: dict = {}
        for d in dims:
            k0 = r[f"{d}__k0"]
            k1 = r.get(f"{d}__k1")
            out[f"{d}_id"] = _key_of(d, k0, k1)
            out[d] = _label_of(d, k0, k1, r)
        for name in extra_names:
            if name in dims:
                continue
            out[name] = _plain(r[name], name)
        if "document" in dims:
            out["document"] = r["document"]
        rows.append(_finish(out, r))

    rows.sort(key=lambda x: tuple(str(x.get(f"{d}_id") or "") for d in dims if d in PERIODS)
              + ((x.get("document_date") or "", x.get("document") or "")
                 if "document" in dims else ())
              + (-Decimal(x["points"]),))
    return {"dims": dims, "rows": rows, "totals": _finish({}, totals_raw),
            "truncated": truncated}


def _plain(value, name: str):
    if value is None:
        return None
    if isinstance(value, date):
        return str(value)
    if name == "document_kind":
        return VISIT_KIND_LABELS.get(getattr(value, "value", value), str(value))
    if name == "item_points":
        return str(to_qty(Decimal(str(value))))
    return value


def _key_of(d: str, k0, k1):
    if d == "technician":
        return k0 if k0 is not None else (f"n:{k1}" if k1 else None)
    if d == "merchant":
        return k0 if k0 is not None else (f"n:{k1}" if k1 else None)
    if d == "month":
        return str(k0)[:7] if k0 is not None else None
    if d == "day":
        return str(k0)[:10] if k0 is not None else None
    if d == "visit_kind":
        return getattr(k0, "value", k0)
    return k0


def _label_of(d: str, k0, k1, r) -> str:
    if d == "technician":
        return r["technician"] or k1 or EMPTY_LABELS[d]
    if d == "merchant":
        return r["merchant"] or k1 or EMPTY_LABELS[d]
    if k0 is None:
        return EMPTY_LABELS.get(d, "—")
    if d == "month":
        return str(k0)[:7]
    if d == "day":
        return str(k0)[:10]
    if d == "visit_kind":
        kind = getattr(k0, "value", k0)
        return VISIT_KIND_LABELS.get(kind, str(kind))
    if d == "document":
        return r["document"]
    if d == "item":
        return str(k0)
    if d == "markaz":
        return str(k0)
    if d in ("rep", "governorate", "branch"):
        return r[d] or f"#{k0}"
    return str(k0)


def _finish(out: dict, r) -> dict:
    out["qty"] = str(to_qty(Decimal(str(r["qty"] or 0))))
    out["points"] = str(to_qty(Decimal(str(r["points"] or 0))))
    for m in ("visits", "technicians", "items"):
        out[m] = int(r[m] or 0)
    return out
