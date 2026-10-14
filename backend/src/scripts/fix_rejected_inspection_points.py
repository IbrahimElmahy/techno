from __future__ import annotations

import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.inspection import Inspection, InspectionStatus
from src.models.loyalty import PointKind, PointRecord
from src.models.org import Branch
from src.services import audit_service, points_service

ZERO = Decimal("0.000")
KINDS = (PointKind.inspection, PointKind.inspection_reverse)


def _q(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.001"))


def run(*, execute: bool, orphans: bool) -> int:
    db = SessionLocal()
    try:
        branches = {b.id: b.name for b in db.scalars(select(Branch)).all()}
        nets = db.execute(
            select(PointRecord.inspection_id, PointRecord.customer_id,
                   func.sum(PointRecord.delta), func.count(PointRecord.id))
            .where(PointRecord.inspection_id.is_not(None), PointRecord.kind.in_(KINDS))
            .group_by(PointRecord.inspection_id, PointRecord.customer_id)).all()
        ids = {iid for iid, *_ in nets}
        found = {i.id: i for i in db.scalars(
            select(Inspection).where(Inspection.id.in_(ids))).all()} if ids else {}
        cids = {cid for _iid, cid, *_ in nets}
        parties = db.execute(select(Customer.id, Customer.name, Customer.branch_id)
                             .where(Customer.id.in_(cids))).all() if cids else []
        names = {c.id: c.name for c in parties}
        cust_branch = {c.id: c.branch_id for c in parties}

        rejected, missing = [], []
        for iid, cid, net, n in nets:
            net = _q(net)
            if net == ZERO:
                continue
            insp = found.get(iid)
            if insp is None:
                missing.append((iid, cid, net, n, None))
            elif insp.status == InspectionStatus.rejected:
                rejected.append((iid, cid, net, n, insp))

        def report(title: str, rows: list) -> None:
            print(f"\n{title}: {len(rows)} — صافي {_q(sum((r[2] for r in rows), ZERO))}")
            per: dict[str, list] = defaultdict(lambda: [0, ZERO])
            for _iid, cid, net, _n, insp in rows:
                bid = insp.branch_id if insp is not None else cust_branch.get(cid)
                per[branches.get(bid, "-")][0] += 1
                per[branches.get(bid, "-")][1] += net
            for branch, (count, total) in sorted(per.items()):
                print(f"  {branch}: {count} — {_q(total)}")
            for iid, cid, net, n, insp in rows[:15]:
                doc = insp.document_number if insp is not None else f"#{iid} (محذوفة)"
                print(f"  {doc}: {names.get(cid, cid)} صافي {net} من {n} حركة")

        report("معاينات مرفوضة ما زالت تخصم نقاطاً", rejected)
        report("حركات نقاط لمعاينات غير موجودة", missing)

        todo = rejected + (missing if orphans else [])
        if not todo:
            return 0
        if not execute:
            hint = "" if orphans else " (`--orphans` لإدراج المعاينات غير الموجودة)"
            print(f"\nعرض فقط — `--yes` للتنفيذ{hint}.")
            return 0
        for iid, cid, net, _n, insp in todo:
            record = points_service.post(
                db, customer_id=cid, kind=PointKind.inspection_reverse, delta=-net,
                inspection_id=iid, actor_user_id=None)
            audit_service.record(
                db, action="inspection.fix_rejected_points", actor_user_id=None,
                entity_type="inspection", entity_id=iid,
                before={"customer_id": cid, "net": str(net),
                        "status": insp.status.value if insp is not None else "missing"},
                after={"point_record_id": record.id, "delta": str(-net)})
        db.commit()
        print(f"\nتم رد النقاط عن {len(todo)} معاينة.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    sys.exit(run(execute="--yes" in args, orphans="--orphans" in args))
