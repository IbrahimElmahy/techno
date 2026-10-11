from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import aliased

from src.lib import coupon_lifecycle
from src.models.customer import Customer
from src.models.loyalty import PointKind, PointRecord
from src.models.org import Governorate
from src.models.sales import SalesInvoice
from src.models.user import User

MONTHS = [f"m{i:02d}" for i in range(1, 13)]
EXCLUDED_TYPES = ("internal", "owner", "employee")
SALE_KINDS = (PointKind.earn, PointKind.reverse, PointKind.adjustment, PointKind.void_reclaim)


class PointsYearlyError(Exception):
    pass


def _q(v: Decimal, places: str = "0.001") -> str:
    return str(v.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def _coupon_side(kind) -> str | None:
    k = coupon_lifecycle.norm_kind(kind) if kind else ""
    if "ذهب" in k:
        return "gold"
    if "فض" in k:
        return "silver"
    return None


def yearly(db, current, *, year: int, branch_id=None, gold_points: Decimal = Decimal(30),
           silver_points: Decimal = Decimal(10)) -> dict:
    if year < 2000 or year > 2100:
        raise PointsYearlyError("سنة غير صحيحة")
    if gold_points <= 0 or silver_points <= 0:
        raise PointsYearlyError("نقاط الكوبون يجب أن تكون أكبر من صفر")
    d1, d2 = date(year, 1, 1), date(year, 12, 31)

    people: dict[int, dict] = {}

    def person(key: int) -> dict:
        p = people.get(key)
        if p is None:
            p = people[key] = {"party_id": key, **{m: Decimal(0) for m in MONTHS},
                               "gold": 0, "silver": 0}
        return p

    when = func.coalesce(SalesInvoice.invoice_date, cast(PointRecord.created_at, Date))
    month = func.extract("month", when)
    stmt = (select(PointRecord.customer_id, month.label("m"), func.sum(PointRecord.delta))
            .outerjoin(SalesInvoice, SalesInvoice.id == PointRecord.sales_invoice_id)
            .join(Customer, Customer.id == PointRecord.customer_id)
            .where(PointRecord.kind.in_(SALE_KINDS), when >= d1, when <= d2,
                   Customer.customer_type.notin_(EXCLUDED_TYPES))
            .group_by(PointRecord.customer_id, month))
    if branch_id is not None:
        stmt = stmt.where(Customer.branch_id == branch_id)
    for cid, m, total in db.execute(stmt).all():
        person(cid)[f"m{int(m):02d}"] += Decimal(str(total or 0))

    life = coupon_lifecycle.lifecycle(db, current, date_field="handout", date_from=d1,
                                      date_to=d2, limit=coupon_lifecycle.MAX_LIMIT)
    for r in life["rows"]:
        side = _coupon_side(r.get("kind"))
        if not side or r.get("party_id") is None:
            continue
        person(r["party_id"])[side] += 1

    info: dict[int, dict] = {}
    ids = list(people)
    rep = aliased(User)
    for i in range(0, len(ids), 5000):
        for c in db.execute(
            select(Customer.id, Customer.name, Customer.code, Customer.phone,
                   Customer.customer_type, Governorate.name.label("gov"),
                   func.coalesce(rep.full_name, rep.username).label("rep"))
            .outerjoin(Governorate, Governorate.id == Customer.governorate_id)
            .outerjoin(rep, rep.id == Customer.rep_id)
            .where(Customer.id.in_(ids[i:i + 5000]))
        ).all():
            info[c.id] = {"party": c.name, "party_code": c.code, "party_phone": c.phone,
                          "party_type": getattr(c.customer_type, "value", c.customer_type),
                          "party_governorate": c.gov, "party_rep": c.rep}

    ratio = silver_points / gold_points
    rows = []
    tot = {m: Decimal(0) for m in MONTHS}
    tot_gold = tot_silver = 0
    for key, p in people.items():
        if info.get(key, {}).get("party_type") in EXCLUDED_TYPES:
            continue
        total = sum((p[m] for m in MONTHS), Decimal(0))
        if not total and not p["gold"] and not p["silver"]:
            continue
        received = Decimal(p["gold"]) + Decimal(p["silver"]) * ratio
        for m in MONTHS:
            tot[m] += p[m]
        tot_gold += p["gold"]
        tot_silver += p["silver"]
        rows.append({
            "party_id": key,
            **info.get(key, {"party": f"#{key}"}),
            **{m: _q(p[m]) for m in MONTHS},
            "total_points": _q(total),
            "earned_coupons": _q(total / gold_points, "0.01"),
            "received_gold": p["gold"], "received_silver": p["silver"],
            "received_in_gold": _q(received, "0.01"),
        })
    rows.sort(key=lambda r: -Decimal(r["total_points"]))
    total_points = sum(tot.values(), Decimal(0))
    return {
        "year": year, "gold_points": str(gold_points), "silver_points": str(silver_points),
        "truncated": bool(life["page"]["truncated"]),
        "rows": rows,
        "totals": {
            **{m: _q(tot[m]) for m in MONTHS},
            "total_points": _q(total_points),
            "earned_coupons": _q(total_points / gold_points, "0.01"),
            "received_gold": tot_gold, "received_silver": tot_silver,
            "received_in_gold": _q(Decimal(tot_gold) + Decimal(tot_silver) * ratio, "0.01"),
            "parties": len(rows),
        },
    }
