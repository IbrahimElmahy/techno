from __future__ import annotations

from datetime import date

from sqlalchemy import Date, cast, func, literal_column, select, union_all
from sqlalchemy.orm import Session

NAV_LIMIT = 5000


def kind_value(kind: str):
    return literal_column(f"'{kind}'")


def nav_part(model, date_col, kind_col):
    day = func.coalesce(date_col, cast(model.created_at, Date))
    return select(
        kind_col.label("kind"),
        model.id.label("id"),
        model.document_number.label("number"),
        day.label("day"),
        model.created_at.label("created_at"),
    )


def _day(value) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)[:10]


def _row(r) -> dict:
    return {"kind": r.kind, "id": r.id, "number": r.number, "date": _day(r.day)}


def nav_sequence(
    db: Session, parts: list, *, date_from: date | None, date_to: date | None,
    doc_kinds: list[str] | None, doc_id: int | None,
) -> dict:
    u = union_all(*parts).subquery("nav_u")
    order = (u.c.day, u.c.created_at, u.c.id, u.c.kind)

    if date_from is not None and date_to is not None:
        stmt = (select(u.c.kind, u.c.id, u.c.number, u.c.day)
                .where(u.c.day >= date_from, u.c.day <= date_to)
                .order_by(*order).limit(NAV_LIMIT))
        rows = db.execute(stmt).all()
        return {"rows": [{**_row(r), "seq": i + 1} for i, r in enumerate(rows)]}

    if doc_id is None or not doc_kinds:
        total = db.scalar(select(func.count()).select_from(u)) or 0
        last = db.execute(select(u.c.kind, u.c.id, u.c.number, u.c.day)
                          .order_by(*(c.desc() for c in order)).limit(1)).first()
        return {"prev": _row(last) if last else None, "next": None,
                "position": None, "total": total}

    numbered = select(
        u.c.kind, u.c.id, u.c.number, u.c.day,
        func.row_number().over(order_by=order).label("rn"),
        func.count().over().label("total"),
    ).cte("nav_n")
    anchor = (select(numbered.c.rn)
              .where(numbered.c.kind.in_(doc_kinds), numbered.c.id == doc_id)
              .limit(1).scalar_subquery())
    rows = db.execute(
        select(numbered).where(numbered.c.rn.between(anchor - 1, anchor + 1))
        .order_by(numbered.c.rn)).all()
    here = next((r for r in rows if r.kind in doc_kinds and r.id == doc_id), None)
    if here is None:
        total = db.scalar(select(func.count()).select_from(u)) or 0
        return {"prev": None, "next": None, "position": None, "total": total}
    prev = next((r for r in rows if r.rn == here.rn - 1), None)
    nxt = next((r for r in rows if r.rn == here.rn + 1), None)
    return {"prev": _row(prev) if prev else None, "next": _row(nxt) if nxt else None,
            "position": here.rn, "total": here.total}
