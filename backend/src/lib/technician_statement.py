from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, aliased

from src.auth import branch_scope
from src.auth.dependencies import CurrentUser
from src.core.money import to_money, to_qty
from src.lib import arabic
from src.lib.coupon_lifecycle import _plumber_from_notes
from src.lib.inspection_points import VISIT_KIND_LABELS, counted_visit, user_name
from src.models.coupon_receipt import CouponReceipt, receipt_counted
from src.models.customer import Customer
from src.models.inspection import Inspection, InspectionItem
from src.models.org import Governorate
from src.models.user import User
from src.services import points_service

SCOPES = ("plumber", "all")
NOTE_MARK = "%الفني%"


class TechnicianStatementError(Exception):
    pass


def _bounds(year: int, date_from: date | None, date_to: date | None):
    if year < 2000 or year > 2100:
        raise TechnicianStatementError("السنة غير صحيحة")
    y0, y1 = date(year, 1, 1), date(year, 12, 31)
    p0, p1 = date(year - 1, 1, 1), date(year - 1, 12, 31)
    d0, d1 = date_from or y0, date_to or y1
    if d0 > d1:
        raise TechnicianStatementError("تاريخ البداية بعد تاريخ النهاية")
    return y0, y1, p0, p1, d0, d1


def _name_maps(db: Session, scope: str):
    stmt = select(Customer.id, Customer.name, Customer.customer_type)
    if scope == "plumber":
        stmt = stmt.where(Customer.customer_type == "plumber")
    exact: dict[str, tuple] = {}
    loose: dict[str, tuple] = {}
    for cid, name, ctype in db.execute(stmt).all():
        rank = (0 if ctype == "plumber" else 1, cid)
        for table, key in ((exact, (name or "").strip()), (loose, arabic.bare(name))):
            if key and (key not in table or rank < table[key]):
                table[key] = rank
    return ({k: v[1] for k, v in exact.items()}, {k: v[1] for k, v in loose.items()})


def _resolver(db: Session, scope: str):
    exact, loose = _name_maps(db, scope)

    def resolve(name: str | None) -> int | None:
        if not name:
            return None
        return exact.get(name.strip()) or loose.get(arabic.bare(name))
    return resolve


def _receipt_groups(db, current, *, y0, y1, p0, p1, d0, d1):
    r = CouponReceipt
    in_year = and_(r.received_date >= y0, r.received_date <= y1)
    in_prev = and_(r.received_date >= p0, r.received_date <= p1)
    in_period = and_(r.received_date >= d0, r.received_date <= d1)
    stmt = branch_scope.scope(
        select(r.customer_id, case((r.customer_id.is_(None), r.notes)).label("notes"),
               func.coalesce(func.sum(case((in_year, r.coupon_count), else_=0)), 0),
               func.coalesce(func.sum(case((in_prev, r.coupon_count), else_=0)), 0),
               func.coalesce(func.sum(case((in_period, r.coupon_count), else_=0)), 0),
               func.coalesce(func.sum(case(
                   (in_period, r.coupon_count * func.coalesce(r.declared_value, 0)),
                   else_=0)), 0),
               func.count(case((in_period, r.id))),
               func.max(case((r.received_date <= d1, r.received_date)))),
        CouponReceipt, current,
    ).where(receipt_counted(), or_(r.customer_id.is_not(None), r.notes.like(NOTE_MARK)))
    return db.execute(stmt.group_by(r.customer_id, case((r.customer_id.is_(None), r.notes)))).all()


def _visit_groups(db, current, *, d0, d1):
    i = Inspection
    in_period = and_(i.inspection_date >= d0, i.inspection_date <= d1)
    loose = case((i.customer_id.is_(None), i.technician_name))
    stmt = branch_scope.scope(
        select(i.customer_id, loose.label("tech_name"),
               func.count(case((in_period, i.id))),
               func.coalesce(func.sum(case((in_period, i.total_points), else_=0)), 0),
               func.max(case((i.inspection_date <= d1, i.inspection_date)))),
        Inspection, current,
    ).where(counted_visit(), or_(i.customer_id.is_not(None), i.technician_name.is_not(None)))
    return db.execute(stmt.group_by(i.customer_id, loose)).all()


def _blank(key, customer_id=None, name=None) -> dict:
    return {"key": key, "customer_id": customer_id, "name": name, "code": None, "phone": None,
            "customer_type": None, "governorate_id": None, "governorate": None, "markaz": None,
            "rep_id": None, "rep": None,
            "coupons_year": 0, "coupons_prev_year": 0, "coupons_period": 0,
            "coupon_value_period": Decimal(0), "receipts_period": 0,
            "visits_period": 0, "points_period": Decimal(0),
            "last_visit": None, "last_receipt": None, "points_balance": Decimal(0)}


def _later(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return max(a, b)


def statement(
    db: Session,
    current: CurrentUser,
    *,
    year: int,
    date_from: date | None = None,
    date_to: date | None = None,
    rep_id: int | None = None,
    governorate_id: int | None = None,
    search: str | None = None,
    scope: str = "plumber",
    active_only: bool = False,
) -> dict:
    if scope not in SCOPES:
        raise TechnicianStatementError("نطاق غير معروف")
    y0, y1, p0, p1, d0, d1 = _bounds(year, date_from, date_to)
    resolve = _resolver(db, scope)
    rows: dict = {}

    def row_for(customer_id, name):
        if customer_id is not None:
            key = f"c:{customer_id}"
            if key not in rows:
                rows[key] = _blank(key, customer_id=customer_id)
            return rows[key]
        if scope != "all" or not name:
            return None
        key = f"n:{name.strip()}"
        if key not in rows:
            rows[key] = _blank(key, name=name.strip())
        return rows[key]

    for cid, notes, n_year, n_prev, n_period, value, docs, last in _receipt_groups(
            db, current, y0=y0, y1=y1, p0=p0, p1=p1, d0=d0, d1=d1):
        name = None if cid else _plumber_from_notes(notes)
        row = row_for(cid or resolve(name), name)
        if row is None:
            continue
        row["coupons_year"] += int(n_year or 0)
        row["coupons_prev_year"] += int(n_prev or 0)
        row["coupons_period"] += int(n_period or 0)
        row["coupon_value_period"] += Decimal(str(value or 0))
        row["receipts_period"] += int(docs or 0)
        row["last_receipt"] = _later(row["last_receipt"], last)

    for cid, tech_name, visits, points, last in _visit_groups(db, current, d0=d0, d1=d1):
        row = row_for(cid or resolve(tech_name), tech_name)
        if row is None:
            continue
        row["visits_period"] += int(visits or 0)
        row["points_period"] += Decimal(str(points or 0))
        row["last_visit"] = _later(row["last_visit"], last)

    rep = aliased(User)
    rep_of = func.coalesce(Customer.service_rep_id, Customer.rep_id)
    ids = [r["customer_id"] for r in rows.values() if r["customer_id"] is not None]
    cards = (select(Customer.id, Customer.code, Customer.name, Customer.phone,
                    Customer.customer_type, Customer.governorate_id, Governorate.name,
                    Customer.markaz, rep_of, user_name(rep))
             .outerjoin(Governorate, Governorate.id == Customer.governorate_id)
             .outerjoin(rep, rep.id == rep_of))
    plumbers = and_(Customer.customer_type == "plumber", Customer.active.is_(True))
    cards = cards.where(or_(plumbers, Customer.id.in_(ids)) if ids else plumbers)
    seen = set()
    for (cid, code, name, phone, ctype, gov_id, gov, markaz, r_id,
         r_name) in db.execute(cards).all():
        key = f"c:{cid}"
        if scope == "plumber" and ctype != "plumber":
            rows.pop(key, None)
            continue
        row = rows.setdefault(key, _blank(key, customer_id=cid))
        seen.add(key)
        row.update({"name": name, "code": code, "phone": phone, "customer_type": ctype,
                    "governorate_id": gov_id, "governorate": gov, "markaz": markaz,
                    "rep_id": r_id, "rep": r_name})
    for key in [k for k, r in rows.items() if r["customer_id"] is not None and k not in seen]:
        rows.pop(key)

    def active(r) -> bool:
        return bool(r["coupons_year"] or r["coupons_prev_year"] or r["coupons_period"]
                    or r["visits_period"])

    needle = arabic.bare(search) if search and search.strip() else None
    out = []
    for r in rows.values():
        if active_only and not active(r):
            continue
        if rep_id is not None and r["rep_id"] != rep_id:
            continue
        if governorate_id is not None and r["governorate_id"] != governorate_id:
            continue
        if needle and not any(needle in arabic.bare(v)
                              for v in (r["name"], r["code"], r["phone"]) if v):
            continue
        out.append(r)

    balances = points_service.balances(
        db, [r["customer_id"] for r in out if r["customer_id"] is not None]) if out else {}
    for r in out:
        r["points_balance"] = (balances.get(r["customer_id"], Decimal(0))
                               if r["customer_id"] else Decimal(0))

    out.sort(key=lambda r: (-r["coupons_year"], -r["visits_period"], -r["coupons_prev_year"],
                            arabic.bare(r["name"])))
    totals = {
        "technicians": len(out),
        "active": sum(1 for r in out if active(r)),
        "coupons_year": sum(r["coupons_year"] for r in out),
        "coupons_prev_year": sum(r["coupons_prev_year"] for r in out),
        "coupons_period": sum(r["coupons_period"] for r in out),
        "coupon_value_period": sum((r["coupon_value_period"] for r in out), Decimal(0)),
        "receipts_period": sum(r["receipts_period"] for r in out),
        "visits_period": sum(r["visits_period"] for r in out),
        "points_period": sum((r["points_period"] for r in out), Decimal(0)),
        "points_balance": sum((r["points_balance"] for r in out), Decimal(0)),
    }
    return {"year": year, "date_from": str(d0), "date_to": str(d1),
            "rows": [_finish(r) for r in out], "totals": _finish(totals)}


def _finish(r: dict) -> dict:
    out = dict(r)
    for m in ("coupon_value_period",):
        if m in out:
            out[m] = str(to_money(Decimal(str(out[m] or 0))))
    for m in ("points_period", "points_balance"):
        if m in out:
            out[m] = str(to_qty(Decimal(str(out[m] or 0))))
    for m in ("last_visit", "last_receipt"):
        if out.get(m) is not None:
            out[m] = str(out[m])
    return out


def details(
    db: Session,
    current: CurrentUser,
    *,
    year: int,
    customer_id: int | None = None,
    name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    scope: str = "plumber",
) -> dict:
    if scope not in SCOPES:
        raise TechnicianStatementError("نطاق غير معروف")
    if customer_id is None and not (name and name.strip()):
        raise TechnicianStatementError("حدد الفني")
    _, _, _, _, d0, d1 = _bounds(year, date_from, date_to)
    resolve = _resolver(db, scope)

    if customer_id is not None:
        card = db.get(Customer, customer_id)
        if card is None:
            raise TechnicianStatementError("الفني غير موجود")
        names = {card.name.strip()} if card.name else set()
    else:
        names = {name.strip()}

    def owns(text: str | None) -> bool:
        if not text:
            return False
        if customer_id is not None:
            return resolve(text) == customer_id
        return text.strip() in names and resolve(text) is None

    r = CouponReceipt
    rep = aliased(User)
    receipts_stmt = branch_scope.scope(
        select(r.id, r.document_number, r.received_date, r.coupon_count, r.declared_kind,
               r.declared_value, r.customer_id, r.notes, user_name(rep))
        .outerjoin(rep, rep.id == r.rep_user_id),
        CouponReceipt, current,
    ).where(receipt_counted(), r.received_date >= d0, r.received_date <= d1)
    like = [arabic.sort_key(r.notes).like(f"%{arabic.bare(n)}%") for n in names]
    by_note = and_(r.customer_id.is_(None), r.notes.like(NOTE_MARK), or_(*like))
    receipts_stmt = receipts_stmt.where(
        or_(r.customer_id == customer_id, by_note) if customer_id is not None else by_note)
    receipts = []
    for (rid, doc, when, count, kind, value, cid, notes, rep_name) in db.execute(
            receipts_stmt.order_by(r.received_date.desc(), r.id.desc())).all():
        if cid is None and not owns(_plumber_from_notes(notes)):
            continue
        receipts.append({
            "id": rid, "document_number": doc, "received_date": str(when) if when else None,
            "coupon_count": int(count or 0), "coupon_kind": kind,
            "unit_value": str(to_money(Decimal(str(value or 0)))),
            "value": str(to_money(Decimal(str(value or 0)) * int(count or 0))),
            "rep": rep_name,
        })

    i = Inspection
    merchant = aliased(Customer)
    vrep = aliased(User)
    item_count = (select(func.count(InspectionItem.id))
                  .where(InspectionItem.inspection_id == i.id).scalar_subquery())
    visits_stmt = branch_scope.scope(
        select(i.id, i.document_number, i.inspection_date, i.visit_kind, i.visit_type,
               i.inspection_type, i.owner_name, i.owner_address,
               func.coalesce(merchant.name, i.purchase_shop), user_name(vrep), i.total_points,
               item_count, i.customer_id, i.technician_name)
        .outerjoin(merchant, merchant.id == i.merchant_customer_id)
        .outerjoin(vrep, vrep.id == i.rep_user_id),
        Inspection, current,
    ).where(counted_visit(), i.inspection_date >= d0, i.inspection_date <= d1)
    by_name = and_(i.customer_id.is_(None), or_(
        i.technician_name.in_(names),
        arabic.sort_key(func.trim(i.technician_name)).in_({arabic.bare(n) for n in names})))
    visits_stmt = visits_stmt.where(
        or_(i.customer_id == customer_id, by_name) if customer_id is not None else by_name)
    visits = []
    for (vid, doc, when, kind, vtype, itype, owner, address, shop, rep_name, points, n_items,
         cid, tech_name) in db.execute(
            visits_stmt.order_by(i.inspection_date.desc(), i.id.desc())).all():
        if cid is None and not owns(tech_name):
            continue
        kind_value = getattr(kind, "value", kind)
        visits.append({
            "id": vid, "document_number": doc, "inspection_date": str(when) if when else None,
            "visit_kind": VISIT_KIND_LABELS.get(kind_value, kind_value),
            "visit_type": vtype, "inspection_type": itype, "owner_name": owner,
            "owner_address": address, "merchant": shop, "rep": rep_name,
            "points": str(to_qty(Decimal(str(points or 0)))), "items": int(n_items or 0),
        })

    return {
        "date_from": str(d0), "date_to": str(d1),
        "receipts": receipts, "visits": visits,
        "totals": {
            "coupons": sum(x["coupon_count"] for x in receipts),
            "coupon_value": str(to_money(sum((Decimal(x["value"]) for x in receipts), Decimal(0)))),
            "visits": len(visits),
            "points": str(to_qty(sum((Decimal(x["points"]) for x in visits), Decimal(0)))),
        },
    }
