from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import aliased

from src.lib import coupon_lifecycle, inspection_points
from src.models.customer import Customer
from src.models.org import Governorate
from src.models.user import User

MONTHS = [f"m{i:02d}" for i in range(1, 13)]


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

    people: dict = {}

    def person(key, name=None, **info) -> dict:
        p = people.get(key)
        if p is None:
            p = people[key] = {
                "technician_id": key, "technician": name or "—",
                "technician_code": None, "technician_phone": None,
                "technician_governorate": None, "technician_rep": None,
                **{m: Decimal(0) for m in MONTHS}, "gold": 0, "silver": 0,
            }
        for k, v in info.items():
            if v and not p.get(k):
                p[k] = v
        if name and p["technician"] == "—":
            p["technician"] = name
        return p

    pts = inspection_points.analyse(db, dims=["technician", "month"], date_from=d1, date_to=d2,
                                    branch_id=branch_id)
    for r in pts["rows"]:
        month = r.get("month_id")
        if not month or r.get("technician_id") is None:
            continue
        p = person(r["technician_id"], r.get("technician"),
                   technician_code=r.get("technician_code"),
                   technician_phone=r.get("technician_phone"),
                   technician_governorate=r.get("technician_governorate"),
                   technician_rep=r.get("technician_rep"))
        p[f"m{month[5:7]}"] += Decimal(str(r["points"]))

    life = coupon_lifecycle.lifecycle(db, current, date_field="receipt", date_from=d1,
                                      date_to=d2, status="received",
                                      limit=coupon_lifecycle.MAX_LIMIT)
    for r in life["rows"]:
        side = _coupon_side(r.get("kind"))
        if not side or r.get("plumber_id") is None:
            continue
        p = person(r["plumber_id"], r.get("plumber"))
        p[side] += 1

    ids = [k for k, p in people.items() if isinstance(k, int)
           and not (p["technician_code"] and p["technician_rep"])]
    if ids:
        rep = aliased(User)
        for i in range(0, len(ids), 5000):
            for c in db.execute(
                select(Customer.id, Customer.name, Customer.code, Customer.phone,
                       Governorate.name.label("gov"),
                       func.coalesce(rep.full_name, rep.username).label("rep"))
                .outerjoin(Governorate, Governorate.id == Customer.governorate_id)
                .outerjoin(rep, rep.id == func.coalesce(Customer.service_rep_id, Customer.rep_id))
                .where(Customer.id.in_(ids[i:i + 5000]))
            ).all():
                person(c.id, c.name, technician_code=c.code, technician_phone=c.phone,
                       technician_governorate=c.gov, technician_rep=c.rep)

    ratio = silver_points / gold_points
    rows = []
    tot = {m: Decimal(0) for m in MONTHS}
    tot_gold = tot_silver = 0
    for p in people.values():
        total = sum((p[m] for m in MONTHS), Decimal(0))
        received = Decimal(p["gold"]) + Decimal(p["silver"]) * ratio
        if not total and not p["gold"] and not p["silver"]:
            continue
        for m in MONTHS:
            tot[m] += p[m]
        tot_gold += p["gold"]
        tot_silver += p["silver"]
        rows.append({
            **{k: p[k] for k in ("technician_id", "technician", "technician_code",
                                 "technician_phone", "technician_governorate",
                                 "technician_rep")},
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
        "truncated": bool(pts.get("truncated")) or bool(life["page"]["truncated"]),
        "rows": rows,
        "totals": {
            **{m: _q(tot[m]) for m in MONTHS},
            "total_points": _q(total_points),
            "earned_coupons": _q(total_points / gold_points, "0.01"),
            "received_gold": tot_gold, "received_silver": tot_silver,
            "received_in_gold": _q(Decimal(tot_gold) + Decimal(tot_silver) * ratio, "0.01"),
            "technicians": len(rows),
        },
    }
