"""يستورد معاينات نظام ما بعد البيع القديم: الأصناف وأنواعها والمعاينات وبنودها.

    python -m src.scripts.import_erp_visits --dir C:/pgtmp/erp --branch العلياء
    python -m src.scripts.import_erp_visits --dir C:/pgtmp/erp --branch العلياء --yes

بيتعاد تشغيله بأمان: المعاينة اللي رقمها موجود بتتخطى.

---------------------------------------------------------------------------
أربع قرارات:

* **الطرف بيتلاقى بالكود مش بالاسم.** المعاينة بتشاور على `CustomerID` و`PlumberID`
  بأرقام النظام القديم، ونقل الأطراف حفظها في `ERP-C-{id}` و`ERP-P-{id}`. الاسم بيتغيّر
  والرقم لأ.

* **المالك اسم على المستند مش مجرد رابط.** `owner_name` إجباري عندنا، وبيتاخد من اسم
  العميل وقت النقل. المعاينة ورقة بتتطبع وبتتسلّم، والاسم اللي عليها لازم يفضل حتى لو
  كارت العميل اتغيّر بعدين.

* **المعاينة اللي عميلها مش موجود مابتتخطاش.** ١٧٤ معاينة من ١٠٩٢٢ بتشاور على عميل
  مش في الكشف — بتدخل باسم «عميل غير معروف» على المستند، لأن الزيارة حصلت والنقاط
  اتصرفت، والحذف بيخفي شغل حصل.

* **النقاط بتتقرا مابتتحسبش.** `TotalPoint` على البند و مجموعها على المعاينة. حسابها من
  الكمية × النقطة بيدي رقم تاني لو النظام القديم عدّلها بإيده، والورقة المطبوعة عند
  العميل شايلة رقمهم.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.inspection import Inspection, InspectionItem
from src.models.inspection_item_type import InspectionItemType
from src.models.lookup import LookupOption
from src.models.org import Branch
from src.models.role import Role, RoleName
from src.models.user import User
from src.scripts.import_a5 import JUNK, _clean, _money, _read

# أعمدة الملف المصدَّر
(V_KIND, V_A, V_B, V_C, V_D, V_E, V_F, V_G, V_H, V_I, V_J) = range(11)

UNKNOWN_OWNER = "عميل غير معروف"


def _date(v: str) -> date | None:
    """تاريخ النظام القديم رقم `yyyymmdd`."""
    v = (v or "").strip()
    if len(v) != 8 or not v.isdigit():
        return None
    try:
        return date(int(v[:4]), int(v[4:6]), int(v[6:]))
    except ValueError:
        return None


def _ensure_options(db, category: str, values: list[str]) -> int:
    have = {o.value for o in db.scalars(
        select(LookupOption).where(LookupOption.category == category)).all()}
    order = max([o.sort_order for o in db.scalars(
        select(LookupOption).where(LookupOption.category == category)).all()] or [0])
    made = 0
    for v in values:
        if not v or v in have:
            continue
        order += 1
        db.add(LookupOption(category=category, value=v, label=v,
                            sort_order=order, active=True, is_system=False))
        have.add(v)
        made += 1
    return made


def run(folder: str, *, execute: bool, branch_name: str = "") -> None:
    rows = [r for r in _read(os.path.join(folder, "visits.tsv")) if len(r) >= 11]
    by_kind: dict[str, list[list[str]]] = defaultdict(list)
    for r in rows:
        by_kind[r[V_KIND]].append(r)

    items_by_visit: dict[str, list[list[str]]] = defaultdict(list)
    for r in by_kind["VITEM"]:
        items_by_visit[r[V_A]].append(r)

    print("المصدر:")
    for kind, label in (("ITEM", "أصناف معاينة"), ("PTYPE", "أنواع"),
                        ("PDESC", "توصيفات"), ("VISIT", "معاينات"), ("VITEM", "بنود")):
        print(f"   {label:<14}{len(by_kind.get(kind, [])):>7}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    made: dict[str, int] = defaultdict(int)
    skipped: list[str] = []
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit("مافيش فرع اسمه " + branch_name)
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        print("الفرع المستهدف: " + branch.name + "\n")

        role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        rep = db.scalars(
            select(User).where(User.role_id == role.id, User.branch_id == branch.id)
            .order_by(User.id)).first() if role else None
        if rep is None:
            rep = db.scalars(select(User).order_by(User.id)).first()

        # ---------- الأصناف والقوايم ----------
        have_types = {t.name for t in db.scalars(select(InspectionItemType)).all()}
        order = max([t.sort_order for t in db.scalars(
            select(InspectionItemType)).all()] or [0])
        for r in by_kind["ITEM"]:
            name = _clean(r[V_B])
            if not name or JUNK.match(name) or name in have_types:
                continue
            order += 1
            db.add(InspectionItemType(name=name, points=Decimal("0"),
                                      sort_order=order, active=True))
            have_types.add(name)
            made["أصناف معاينة"] += 1

        made["أنواع معاينة"] = _ensure_options(
            db, "inspection_type", [_clean(r[V_B]) for r in by_kind["PTYPE"]])
        made["توصيفات"] = _ensure_options(
            db, "inspection_description", [_clean(r[V_B]) for r in by_kind["PDESC"]])
        db.flush()

        # ---------- المعاينات ----------
        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        taken = {n for (n,) in db.execute(select(Inspection.document_number)).all()}
        type_ids = {t.name: t.id for t in db.scalars(select(InspectionItemType)).all()}

        for r in by_kind["VISIT"]:
            number = f"ERP-V-{r[V_A]}"
            if number in taken:
                continue
            when = _date(r[V_E])
            if when is None:
                skipped.append(f"معاينة {r[V_A]}: تاريخ غير صالح «{r[V_E]}»")
                continue
            customer = by_code.get(f"ERP-C-{r[V_B]}")
            tech = by_code.get(f"ERP-P-{r[V_C]}")
            insp = Inspection(
                branch_id=branch.id, document_number=number,
                inspection_date=when,
                customer_id=customer.id if customer else None,
                # الاسم بيتكتب على المستند: الورقة بتتطبع وبتتسلّم، والاسم اللي عليها
                # لازم يفضل حتى لو كارت العميل اتغيّر بعدين.
                owner_name=(customer.name if customer else UNKNOWN_OWNER)[:160],
                owner_phone=((customer.phone or '')[:32] or None) if customer else None,
                owner_address=_clean(r[V_I])[:240] or None,
                # كل نص بيتقص على حد عموده. «الدور» عندنا ١٦ حرف وعندهم النص حر —
                # «الدور الثاني شقه 2» بيوقّف النقل كله عند أول واحد زيه.
                floor_number=_clean(r[V_H])[:16] or None,
                inspection_type=_clean(r[V_F])[:80] or None,
                description=_clean(r[V_G])[:80] or None,
                technician_name=(tech.name[:160] if tech else None),
                technician_phone=(tech.phone[:32] if tech and tech.phone else None),
                visit_details=_clean(r[V_J])[:1000] or None,
                rep_user_id=rep.id)
            db.add(insp)
            db.flush()
            taken.add(number)
            made["معاينات"] += 1
            if customer is None:
                made["معاينات بلا عميل"] += 1

            total = Decimal("0")
            for it in items_by_visit.get(r[V_A], []):
                name = _clean(it[V_C])
                if not name:
                    continue
                points = _money(it[V_F])
                db.add(InspectionItem(
                    inspection_id=insp.id, item_id=type_ids.get(name),
                    item_name=name[:160], quantity=_money(it[V_D]),
                    points=_money(it[V_E]), total=points))
                total += points
                made["بنود"] += 1
            insp.total_points = total

        db.commit()
        print(f"{'الكيان':<22}{'عدد':>8}")
        print("-" * 30)
        for k, v in sorted(made.items()):
            print(f"{k:<22}{v:>8}")
        if skipped:
            print(f"\nاتخطّى {len(skipped)}:")
            for s in skipped[:10]:
                print("   ", s)
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/erp"
    target = args[args.index("--branch") + 1] if "--branch" in args else ""
    run(folder, execute="--yes" in args, branch_name=target)
