from __future__ import annotations

import csv
import os
import re
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
from src.scripts.wb_profile import ALIAA, WbProfile, dir_from_argv, profile_from_argv

MARMA, PREVIEW = "مرمة", "معاينة"
DESCRIPTION = {
    "1": "حمام ومطبخ", "2": "حمام فقط", "3": "مطبخ فقط", "4": "مسجد",
    "5": "محل", "6": "صيدلية", "7": "مرمه", "8": "2حمام ومطبخ",
}
INSPECTION_TYPE = {"1": "تغذية وصرف", "2": "تغذية فقط", "3": "صرف فقط"}
NOT_AVAILABLE = "#N/A"


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


def _shop_key(v: str | None) -> str:
    s = re.sub(r"[أإآ]", "ا", v or "").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()


def run(folder: str, *, execute: bool, profile: WbProfile = ALIAA) -> None:
    visits = _read(os.path.join(folder, "visits.tsv"))
    points = _read(os.path.join(folder, "points.tsv"))
    reps = _read(os.path.join(folder, "reps.tsv"))
    old_uid_to_emp = {r["user_id"]: r["emp_code"] for r in reps if r.get("user_id")}
    emp_names = {r["emp_code"]: (r.get("new_name") or r.get("erp_name") or "")
                 for r in reps if r.get("emp_code")}
    owner_names = {r["id"]: r["name"] for r in _read(os.path.join(folder, "owners.tsv"))
                   if r.get("id") and r.get("name")}
    plumber_names = {r["code"]: r["name"] for r in _read(os.path.join(folder, "plumbers.tsv"))
                     if r.get("code") and r.get("name")}
    shop_votes: dict[str, Counter] = defaultdict(Counter)
    for v in visits:
        shop, code = _shop_key(v.get("shop")), v.get("trader_a5", "")
        if shop and code:
            shop_votes[shop][code] += 1
    shop_to_trader = {}
    for shop, votes in shop_votes.items():
        code, hits = votes.most_common(1)[0]
        if hits >= 3 and hits >= 0.8 * sum(votes.values()):
            shop_to_trader[shop] = code
    for v in visits:
        if not v.get("owner_name"):
            v["owner_name"] = owner_names.get(v.get("owner_erp", ""), "")
        if not v.get("plumber_name"):
            v["plumber_name"] = plumber_names.get(v.get("plumber_code", ""), "")
        if not v.get("trader_a5"):
            mid = v.get("merchant_id", "")
            if mid.startswith(("AL-A5-", "A5-")):
                v["trader_a5"] = mid
            elif v.get("trader_code_raw") == NOT_AVAILABLE:
                continue
            elif shop_to_trader.get(_shop_key(v.get("shop"))):
                v["trader_a5"] = shop_to_trader[_shop_key(v.get("shop"))]
                v["_trader_from_shop"] = "1"

    by_visit: dict[str, list[dict[str, str]]] = defaultdict(list)
    for p in points:
        if p.get("visit_id"):
            by_visit[p["visit_id"]].append(p)
    visit_ids = {v.get("id", "") for v in visits}
    orphan_points = sum(1 for p in points if p.get("visit_id", "") not in visit_ids)

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == profile.branch))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{profile.branch}».")
        users = {u.username: u for u in db.scalars(select(User)).all()}
        owners = {o.code: o for o in db.scalars(select(Owner)).all() if o.code}
        custs = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        by_id = {c.id: c for c in custs.values()}

        def resolve(code: str) -> Customer | None:
            c = (custs.get(code) or custs.get(profile.trader_prefix + code)
                 or custs.get(profile.trader_alias.get(code, "")))
            if c is None or c.active:
                return c
            mark = "(مدموج في #"
            if mark in (c.name or ""):
                try:
                    keep = int(c.name.split(mark, 1)[1].split(")", 1)[0])
                    return by_id.get(keep) or c
                except ValueError:
                    return c
            return c

        taken = {n for (n,) in db.execute(select(Inspection.document_number)).all()}

        plan: list[tuple[dict[str, str], Owner | None, Customer | None, User | None]] = []
        notes: Counter = Counter()
        n_items = 0
        fresh = 0
        blocked: Counter = Counter()

        for v in visits:
            vid = v.get("id", "")
            if not vid:
                notes["صف بلا رقم"] += 1
                continue
            doc = profile.visit_prefix + vid
            if doc in taken:
                notes["موجود خلاص — اتخطّى"] += 1
                continue
            fresh += 1
            if _date(v.get("visit_date", "")) is None:
                notes["تاريخ غير صالح — اتخطّى"] += 1
                continue
            owner = owners.get(profile.owner_prefix + v.get("owner_erp", ""))
            if owner is None and v.get("owner_erp"):
                notes["المالك مش عندنا"] += 1
            trader_code = v.get("trader_a5", "")
            trader = None
            if trader_code:
                trader = resolve(trader_code)
            if trader is not None and v.get("_trader_from_shop"):
                notes["تاجر من اسم المحل (ربط العميل القديم)"] += 1
            if trader_code and trader is None:
                notes["كود تاجر مش عندنا"] += 1
            elif not trader_code:
                notes["مافيش كود تاجر على الصف"] += 1
            if v.get("trader_code_raw") == NOT_AVAILABLE:
                notes["كود التاجر #N/A في الملف — بلا تاجر"] += 1
            if v.get("vtype") and v["vtype"] not in INSPECTION_TYPE:
                notes[f"نوع معاينة غير معروف: {v['vtype']}"] += 1
            emp = old_uid_to_emp.get(v.get("rep_erp", ""))
            rep = users.get(profile.emp_to_user.get(emp, "")) if emp else None
            if emp and rep is None:
                notes[f"مندوب مش موجود: {emp}"] += 1
            if rep is None:
                notes["✘ بلا مندوب — اتخطّى"] += 1
                blocked[emp or f"(رقم مستخدم {v.get('rep_erp', '') or '—'})"] += 1
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
        if fresh:
            if orphan_points:
                print(f"\n   {'بنود معاينتها ليست في الصفحة — تُخطّت':<38}{orphan_points:>7}")
            if blocked:
                print("\n   معاينات تُخطّت لأن مندوبها بلا حساب:")
                for emp, c in blocked.most_common():
                    uname = profile.emp_to_user.get(emp)
                    acct = (f"الحساب «{uname}» غير موجود" if uname
                            else "ليس في خريطة المناديب")
                    print(f"      {emp:<10}{emp_names.get(emp, '')[:22]:<24}{acct:<30}{c:>7}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        made = items = 0
        for v, owner, trader, rep in plan:
            vid = v["id"]
            insp = Inspection(
                branch_id=branch.id, document_number=profile.visit_prefix + vid,
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
    profile = profile_from_argv(args)
    run(dir_from_argv(args, profile), execute="--yes" in args, profile=profile)


if __name__ == "__main__":
    main()
