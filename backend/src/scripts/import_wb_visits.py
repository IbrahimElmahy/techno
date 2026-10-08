from __future__ import annotations

import csv
import os
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.inspection import Inspection, InspectionItem, InspectionStatus, VisitKind
from src.models.org import Branch
from src.models.owner import Owner
from src.models.user import User
from src.scripts.import_wb_traders import ALIAS

BRANCH = "العلياء"
DOC_PREFIX = "WBV-"
TRADER_PREFIX = "WB-T-"
MARMA, PREVIEW = "مرمة", "معاينة"
DESCRIPTION = {
    "1": "حمام ومطبخ", "2": "حمام فقط", "3": "مطبخ فقط", "4": "مسجد",
    "5": "محل", "6": "صيدلية", "7": "مرمه", "8": "2حمام ومطبخ",
}
INSPECTION_TYPE = {"1": "تغذية وصرف", "2": "تغذية فقط", "3": "صرف فقط"}

EMP_TO_USER = {
    "EMP-0053": "ashraf", "EMP-0002": "ibrahim.khattab", "EMP-0003": "anas",
    "EMP-0008": "bayoumy", "EMP-0004": "hassan.eid", "EMP-0005": "ahmed.torky",
    "EMP-0054": "care", "EMP-0006": "mohamed.mamdouh", "EMP-0007": "medhat",
    "EMP-0055": "mohamed.torky", "EMP-0040": "sales.dept2",
    "EMP-0045": "car.a", "EMP-0043": "car.b", "EMP-0046": "car.g",
    "EMP-0044": "car.d", "EMP-0047": "car.sharqia",
}


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def _date(v: str) -> date | None:
    v = (v or "").strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(v[:10] if "-" in v else v[:8], fmt).date()
        except ValueError:
            continue
    return None


def _cut(v: str | None, n: int) -> str | None:
    v = (v or "").strip()
    return v[:n] if v else None


def _num(v: str) -> Decimal:
    try:
        return Decimal((v or "0").strip() or 0)
    except (InvalidOperation, ValueError):
        return Decimal(0)


def run(folder: str, *, execute: bool) -> None:
    visits = _read(os.path.join(folder, "visits.tsv"))
    points = _read(os.path.join(folder, "points.tsv"))
    reps = _read(os.path.join(folder, "reps.tsv"))
    old_uid_to_emp = {r["user_id"]: r["emp_code"] for r in reps if r.get("user_id")}

    by_visit: dict[str, list[dict[str, str]]] = defaultdict(list)
    for p in points:
        if p.get("visit_id"):
            by_visit[p["visit_id"]].append(p)

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == BRANCH))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{BRANCH}».")
        users = {u.username: u for u in db.scalars(select(User)).all()}
        owners = {o.code: o for o in db.scalars(select(Owner)).all() if o.code}
        custs = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        taken = {n for (n,) in db.execute(select(Inspection.document_number)).all()}

        plan: list[tuple[dict[str, str], Owner | None, Customer | None, User | None]] = []
        notes: Counter = Counter()
        n_items = 0

        for v in visits:
            vid = v.get("id", "")
            if not vid:
                notes["صف بلا رقم"] += 1
                continue
            doc = DOC_PREFIX + vid
            if doc in taken:
                notes["موجود خلاص — اتخطّى"] += 1
                continue
            if _date(v.get("visit_date", "")) is None:
                notes["تاريخ غير صالح — اتخطّى"] += 1
                continue
            owner = owners.get("WB-C-" + v.get("owner_erp", ""))
            if owner is None and v.get("owner_erp"):
                notes["المالك مش عندنا"] += 1
            trader_code = v.get("trader_a5", "")
            trader = None
            if trader_code:
                trader = (custs.get(trader_code)
                          or custs.get(TRADER_PREFIX + trader_code)
                          or custs.get(ALIAS.get(trader_code, "")))
            if trader_code and trader is None:
                notes["كود تاجر مش عندنا"] += 1
            elif not trader_code:
                notes["مافيش كود تاجر على الصف"] += 1
            emp = old_uid_to_emp.get(v.get("rep_erp", ""))
            rep = users.get(EMP_TO_USER.get(emp, "")) if emp else None
            if emp and rep is None:
                notes[f"مندوب مش موجود: {emp}"] += 1
            if rep is None:
                notes["✘ بلا مندوب — اتخطّى"] += 1
                continue
            plan.append((v, owner, trader, rep))
            n_items += len(by_visit.get(vid, []))

        print(f"معاينات في الملف: {len(visits)}   ·   بنود: {len(points)}")
        for k, c in notes.most_common(10):
            print(f"   {k:<38}{c:>7}")
        print(f"\n   {'معاينات هتتعمل':<38}{len(plan):>7}")
        print(f"   {'بنود هتتعمل':<38}{n_items:>7}")
        print(f"   {'منها ليها مالك':<38}{sum(1 for _, o, _, _ in plan if o):>7}")
        print(f"   {'منها ليها تاجر':<38}{sum(1 for _, _, t, _ in plan if t):>7}")
        print(f"   {'منها ليها مندوب':<38}{sum(1 for _, _, _, r in plan if r):>7}")
        dist = Counter((r.full_name if r else "(بلا مندوب)") for _, _, _, r in plan)
        print("\n   التوزيع على المناديب:")
        for k, c in dist.most_common():
            print(f"      {str(k)[:28]:<30}{c:>7}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        made = items = 0
        for v, owner, trader, rep in plan:
            vid = v["id"]
            insp = Inspection(
                branch_id=branch.id, document_number=DOC_PREFIX + vid,
                visit_kind=VisitKind.technician,
                certificate_number=int(vid) if vid.isdigit() else None,
                description=DESCRIPTION.get(v.get("disc", "")),
                inspection_type=INSPECTION_TYPE.get(v.get("vtype", "")),
                visit_type=(MARMA if v.get("is_marma") == "1" else PREVIEW),
                status=(InspectionStatus.accepted if v.get("visit_kind") != "0"
                        else InspectionStatus.rejected),
                inspection_date=_date(v["visit_date"]),
                owner_id=owner.id if owner else None,
                owner_name=_cut(v.get("owner_name"), 160) or "—",
                owner_address=_cut(v.get("owner_address") or v.get("address"), 240),
                floor_number=_cut(v.get("floor"), 16),
                technician_name=_cut(v.get("plumber_name"), 160),
                merchant_customer_id=trader.id if trader else None,
                purchase_shop=_cut(v.get("shop"), 160),
                visit_details=_cut(v.get("visit_notes") or v.get("notes"), 1000),
                rep_user_id=rep.id,
                total_points=sum(_num(p.get("total_point"))
                                 for p in by_visit.get(vid, [])),
            )
            db.add(insp)
            db.flush()
            made += 1
            for p in by_visit.get(vid, []):
                db.add(InspectionItem(
                    inspection_id=insp.id, item_id=None,
                    item_name=_cut(p.get("item_name"), 160) or "—",
                    quantity=_num(p.get("qty")),
                    points=_num(p.get("point_count")),
                    total=_num(p.get("total_point")),
                ))
                items += 1
        db.commit()

        total = db.scalar(select(func.count()).select_from(Inspection)) or 0
        titems = db.scalar(select(func.count()).select_from(InspectionItem)) or 0
        print(f"\n✔ اتعمل {made} معاينة و{items} بند")
        print(f"   الإجمالي: {total} معاينة · {titems} بند")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
