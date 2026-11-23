from __future__ import annotations

import sys

from sqlalchemy import func, select, update

from src.core.db import SessionLocal
from src.models.hr_payroll_run import PayrollLine, PayrollRun
from src.models.inspection import Inspection
from src.services import salary_service

FROM_USER = 64
TO_USER = 63
BRANCH = 2


def main() -> None:
    execute = "--yes" in sys.argv[1:]
    actor = int(next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--actor=")), "1"))
    db = SessionLocal()
    try:
        ids = db.scalars(select(Inspection.id).where(Inspection.rep_user_id == FROM_USER)
                         .order_by(Inspection.id)).all()
        span = db.execute(select(func.min(Inspection.inspection_date),
                                 func.max(Inspection.inspection_date))
                          .where(Inspection.rep_user_id == FROM_USER)).one()
        print(f"معاينات هتتنقل: {len(ids)} من {span[0]} لـ {span[1]}")
        print("IDS", ",".join(str(i) for i in ids))
        db.execute(update(Inspection).where(Inspection.id.in_(ids)).values(rep_user_id=TO_USER))
        db.flush()
        run_id = db.scalar(select(PayrollRun.id).where(
            PayrollRun.branch_id == BRANCH, PayrollRun.year == 2026, PayrollRun.month == 11))
        db.execute(update(PayrollLine).where(PayrollLine.run_id == run_id,
                                             PayrollLine.employee_id == 40)
                   .values(commission_override=None))
        db.flush()
        salary_service.calculate(db, branch_id=BRANCH, year=2026, month=11, actor_user_id=actor)
        m = salary_service.month_out(db, branch_id=BRANCH, year=2026, month=11)
        for ln in m["lines"]:
            if ln.get("employee_id") in (40, 108, 31):
                print(ln["name"], "عمولة", ln.get("commission"), "صافي", ln.get("net"))
        print("صافي الشهر", m["run"]["net"] if m.get("run") else None)
        if execute:
            db.commit()
            print("APPLIED")
        else:
            db.rollback()
            print("DRY RUN")
    finally:
        db.close()


if __name__ == "__main__":
    main()
