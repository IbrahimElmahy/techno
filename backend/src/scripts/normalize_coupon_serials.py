from __future__ import annotations

import sys

from sqlalchemy import text

from src.core.db import SessionLocal
from src.services import audit_service

PREFIX_KIND = {"ذهبى": "ذهبي", "ذهبي": "ذهبي", "فضى": "فضي", "فضي": "فضي", "ابيض": "ابيض"}

KIND_FROM_PREFIX = "CASE regexp_replace(serial, '-?[0-9]+$', '') " + " ".join(
    f"WHEN '{p}' THEN '{k}'" for p, k in PREFIX_KIND.items()) + " END"
PREFIXED = "serial ~ '^\\D+-?[0-9]+$'"
DIGITS = "regexp_replace(serial, '^\\D+-?', '')"


def _plan(db, table: str) -> dict:
    rows = db.execute(text(
        f"SELECT count(*), count(*) FILTER (WHERE coupon_kind IS NULL), "
        f"count(*) FILTER (WHERE coupon_kind IS NULL AND ({KIND_FROM_PREFIX}) IS NULL) "
        f"FROM {table} WHERE {PREFIXED}")).one()
    clash = db.execute(text(
        f"SELECT count(*) FROM (SELECT coalesce(coupon_kind, {KIND_FROM_PREFIX}) k, "
        f"CASE WHEN {PREFIXED} THEN {DIGITS} ELSE serial END s FROM {table} "
        f"GROUP BY 1, 2 HAVING count(*) > 1) x")).scalar()
    return {"prefixed": rows[0], "kind_missing": rows[1], "kind_unknown": rows[2], "clash": clash}


def run(execute: bool) -> None:
    db = SessionLocal()
    try:
        plans = {t: _plan(db, t) for t in ("coupon_issue_line", "coupon_receipt_line")}
        for t, p in plans.items():
            print(t, p)
        if any(p["clash"] or p["kind_unknown"] for p in plans.values()):
            raise SystemExit("توقف: أرقام ستتكرر أو فئة غير معروفة")
        if not execute:
            print("تجربة فقط — أضف --yes للتنفيذ")
            return
        for t in plans:
            n = db.execute(text(
                f"UPDATE {t} SET coupon_kind = coalesce(coupon_kind, {KIND_FROM_PREFIX}), "
                f"serial = {DIGITS} WHERE {PREFIXED}")).rowcount
            print(t, "→", n)
        audit_service.record(db, action="coupon.normalize_serials", actor_user_id=None,
                             entity_type="coupon_serials", entity_id=0,
                             before={t: p for t, p in plans.items()})
        db.commit()
        print("✔ تم")
    finally:
        db.close()


if __name__ == "__main__":
    run("--yes" in sys.argv[1:])
