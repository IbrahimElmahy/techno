"""يستورد أطراف نظام ما بعد البيع القديم (قاعدة `erp`): سباكين وملّاك وتجار.

    python -m src.scripts.import_erp_parties --dir C:/pgtmp/erp --branch العلياء
    python -m src.scripts.import_erp_parties --dir C:/pgtmp/erp --branch العلياء --yes

بيتعاد تشغيله بأمان: المطابقة بالكود، والموجود بيتحدّث والناقص بيتعمل.

---------------------------------------------------------------------------
أربع قرارات:

* **التصنيف بيتقرا من الداتا مش من جدول.** `CustomerCategoryId` و`CustomerGroupID` و
  `CustomerTypeId` كلهم صفر على الـ٩٤٥٦ صف. اللي بيفرّق فعلاً حاجتين: البادئة «فنى» على
  الاسم، ووجود الكود في جدول الموزعين/التجار. الباقي مالك — وده اللي بيتطابق مع إن ٧٩٥٦
  من الـ٩٤٥٦ عليهم معاينة، والمعاينة بتحصل في بيت المالك.

* **`wh_Customers` مش عملاء بس.** فيه ١٦٤٥ سباك و١١٥ تاجر مسجّلين جواه كمان — نفس الناس
  اللي في `wh_Plumbers` و`wh_Distributors`، متسجّلين مرة تانية عشان النظام كان محتاجهم
  «عميل» عشان يعمل عليهم حركة. فالمطابقة بالاسم بتمنع تكرارهم عندنا.

* **الفرع العلياء.** ٣٤٩ من عملاء العلياء أسماؤهم في النظام ده مقابل ٩ من أكتوبر،
  والمناطق كلها البحيرة والغربية والمنوفية. الفرع بيتحدد من `--branch` برضه — الرقم ده
  دليل مش قاعدة.

* **مندوب خدمة العملاء غير مندوب المبيعات.** `SalesRepId` هنا مندوب الخدمة — اللي بيعاين
  عند العميل وبياخد منه الكوبونات. مندوب المبيعات جاي من a5 وبيفضل مكانه. لو الاتنين
  اتحطوا في خانة واحدة، تقرير المناديب بيجمّع ناس على شغل مش بتاعهم.

* **الكود بيتحفظ عشان المعاينات تلاقي ناسها.** المعاينة بتشاور على `CustomerID` و
  `PlumberID` بأرقام النظام القديم، فالكود عندنا بيبقى `ERP-C-{id}` و`ERP-P-{id}` —
  ومن غير كده الخطوة الجاية مالهاش طريق ترجع بيه.
"""
from __future__ import annotations

import os
import re
import sys
from collections import Counter

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.security import hash_password
from src.models.customer import Customer
from src.models.org import Branch, Territory
from src.models.role import Role, RoleName
from src.models.user import User
from src.scripts.import_a5 import JUNK, _clean, _read

# «فنى فلان» — البادئة اللي نظامهم بيعلّم بيها الفني.
TECH = re.compile(r"^\s*(فنى|فني|السباك|سباك)\b")

PLUMBER, OWNER, TRADER = "plumber", "owner", "trader"

# نوع الصف في الملف المصدَّر → بادئة الكود عندنا.
CODE_PREFIX = {"PLUMBER": "ERP-P", "CUSTOMER": "ERP-C",
               "DIST": "ERP-D", "MERCHANT": "ERP-M"}

(F_KIND, F_ID, F_CODE, F_NAME, F_PHONE, F_ADDR, F_REGION, F_REP, F_ACTIVE) = range(9)


def _norm(s: str) -> str:
    s = re.sub(r"[أإآٱ]", "ا", s or "").replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", s).strip()


def _classify(row: list[str], plumber_names: set[str],
              trade_codes: set[str]) -> str:
    name = _clean(row[F_NAME])
    if TECH.search(name) or _norm(name) in plumber_names:
        return PLUMBER
    if row[F_CODE] and row[F_CODE] in trade_codes:
        return TRADER
    return OWNER


def run(folder: str, *, execute: bool, branch_name: str = "") -> None:
    rows = [r for r in _read(os.path.join(folder, "parties.tsv")) if len(r) >= 9]
    by_kind: dict[str, list[list[str]]] = {}
    for r in rows:
        by_kind.setdefault(r[F_KIND], []).append(r)

    plumber_names = {_norm(r[F_NAME]) for r in by_kind.get("PLUMBER", [])}
    trade_codes = {r[F_CODE] for r in by_kind.get("DIST", []) + by_kind.get("MERCHANT", [])
                   if r[F_CODE]}

    print("المصدر:")
    for kind, label in (("PLUMBER", "سباكين"), ("CUSTOMER", "عملاء"),
                        ("DIST", "موزعين"), ("MERCHANT", "تجار"), ("REP", "مناديب")):
        print(f"   {label:<10}{len(by_kind.get(kind, [])):>7}")

    # كل صف هيتحوّل لإيه. السباك من جدوله سباك، والعميل بيتصنّف.
    plan: list[tuple[list[str], str]] = []
    for r in by_kind.get("PLUMBER", []):
        plan.append((r, PLUMBER))
    for r in by_kind.get("CUSTOMER", []):
        plan.append((r, _classify(r, plumber_names, trade_codes)))
    for kind in ("DIST", "MERCHANT"):
        for r in by_kind.get(kind, []):
            plan.append((r, TRADER))

    counts = Counter(t for _r, t in plan)
    print("\nالتصنيف:")
    for value, label in ((PLUMBER, "سباك"), (OWNER, "مالك"), (TRADER, "تاجر")):
        print(f"   {label:<10}{counts.get(value, 0):>7}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    made = Counter()
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
        terr = db.scalars(select(Territory).where(Territory.branch_id == branch.id)
                          .order_by(Territory.id)).first()
        if terr is None:
            raise SystemExit("الفرع مالوش منطقة واحدة على الأقل.")

        # ---------- مناديب الخدمة ----------
        #
        # الـ16 مندوب بتوع نظام ما بعد البيع. من غيرهم كل معاينة وكل عميل بيقعد على
        # مندوب واحد افتراضي، وتقرير «زيارات المناديب» بيرجّع صف واحد فيه الـ10922.
        service_reps: dict[str, User] = {}
        by_full = {(u.full_name or "").strip(): u for u in db.scalars(select(User)).all()
                   if (u.full_name or "").strip()}
        taken_names = {u.username for u in db.scalars(select(User)).all()}
        password = os.environ.get("SEED_PASSWORD", "").strip()
        for r in by_kind.get("REP", []):
            name = _clean(r[F_NAME])
            if not name or JUNK.match(name):
                continue
            user = by_full.get(name)
            if user is None:
                if not password:
                    skipped.append(f"مندوب «{name}»: محتاج SEED_PASSWORD")
                    continue
                username = f"svc.{r[F_ID]}"
                while username in taken_names:
                    username += "x"
                user = User(username=username, password_hash=hash_password(password),
                            role_id=role.id if role else None, branch_id=branch.id,
                            full_name=name, active=True)
                db.add(user)
                db.flush()
                taken_names.add(username)
                by_full[name] = user
                made["مناديب خدمة"] += 1
            service_reps[r[F_ID]] = user
        db.flush()

        existing = db.scalars(select(Customer)).all()
        by_code = {c.code: c for c in existing if c.code}
        # المطابقة بالاسم جوّه الفرع: نفس الشخص متسجّل في النظامين، وتكراره عندنا معناه
        # رصيدين لواحد. الاسم متطبّع عشان «عبد» و«عبدالـ» ما يبقوش اتنين.
        by_name = {_norm(c.name): c for c in existing if c.branch_id == branch.id}

        for row, kind in plan:
            name = _clean(row[F_NAME])
            if not name or JUNK.match(name):
                skipped.append(f"اسم غير صالح: «{name}»")
                continue
            code = f"{CODE_PREFIX[row[F_KIND]]}-{row[F_ID]}"
            target = by_code.get(code) or by_name.get(_norm(name))
            phone = _clean(row[F_PHONE])[:32] or None
            address = _clean(row[F_ADDR])[:240] or None

            if target is None:
                svc = service_reps.get(row[F_REP])
                target = Customer(
                    code=code, name=name, customer_type=kind,
                    rep_id=rep.id, service_rep_id=svc.id if svc else None,
                    territory_id=terr.id, branch_id=branch.id,
                    phone=phone, address=address,
                    active=row[F_ACTIVE] != "0")
                db.add(target)
                db.flush()
                by_code[code] = target
                by_name[_norm(name)] = target
                made[f"جديد: {kind}"] += 1
                continue

            # موجود — بنكمّل الناقص وبنصحّح التصنيف، ومابنمسحش حاجة مكتوبة.
            made[f"موجود: {kind}"] += 1
            if not target.phone and phone:
                target.phone = phone
            if not target.address and address:
                target.address = address
            # التصنيف بيتحدّث بس لو الموجود «تاجر» (الافتراضي بتاع نقل a5) والجديد أدق.
            if kind != TRADER and target.customer_type == TRADER:
                target.customer_type = kind
                made[f"اتصنّف: {kind}"] += 1
            svc = service_reps.get(row[F_REP])
            if svc is not None and target.service_rep_id != svc.id:
                target.service_rep_id = svc.id
                made["اتربط بمندوب خدمة"] += 1

        db.commit()
        print(f"{'الحالة':<22}{'عدد':>8}")
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
    target_branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    run(folder, execute="--yes" in args, branch_name=target_branch)
