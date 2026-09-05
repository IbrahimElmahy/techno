"""يزامن كشف العملاء مع a5 — بيرجّع اللي اتمسح غلط وبيمشّي اللي اتغيّر عندهم.

    python -m src.scripts.sync_a5_customers --dir C:/pgtmp/a5cust          # يعرض بس
    python -m src.scripts.sync_a5_customers --dir C:/pgtmp/a5cust --yes    # ينفّذ

بيتعاد تشغيله بأمان: المطابقة بالكود، والموجود بيتحدّث والناقص بيتعمل. **مافيش حذف
ولا تعطيل** — السكربت ده بيضيف ويصحّح وبس.

---------------------------------------------------------------------------
**ليه أصلاً:** التزامن اليومي (`deploy/a5_sync.ps1`) بيصدّر المستندات والقيود بس —
مافيش `Cust` فيه. فكشف العملاء وقف عند لقطة ٢٩ أغسطس، وa5 كمّل شغل عليها.

**والأهم: ٤٩٩ كارت اتعملوا واتمسحوا.** اتقاس بمحاكاة المستورد على اللقطة الأصلية:
كان هيعمل ١٬٣٠٦ كارت في العلياء، والموجود عندنا ٨٠٧. السبب سلسلة من خطوتين:

* `import_erp_parties` كان بيغيّر تصنيف الكارت لو صف في ERP اسمه بيطابقه —
  فتاجر عند a5 اسمه زي مالك عند ERP بقى «مالك».
* `split_owners --purge` بيمسح كل «مالك» مالوش أثر مالي، من غير ما يبص على الكود.
  وكتير من تجار a5 مالهمش فواتير.

البصمة إن ١٣ منهم نجوا في جدول `owner` وهُمّ لسه شايلين `AL-A5-…`. الحارسين
اتحطوا في السكربتين، والسكربت ده بيرجّع اللي راح.

**a5 مصدر الحقيقة لتلات حاجات وبس:** الوجود (الكارت موجود ولا لأ)، والمندوب
(`ph1`)، وإن الكارت **تاجر**. الباقي — الاسم اللي اتظبط عندنا، والتصنيفات اللي
اتاخدت بقرار (موظف، داخلي، معرض) — مابيتلمسش، وبيتقال في التقرير لو اختلف.

**`ph1` مش تليفون، هو اسم المندوب.** a5 عنده عمود مخصص (`Emp_Bos`) وهو فاضي في
الـ١٬٩٥٨ كارت كلهم، واللي بيدخّل بيكتب اسم المندوب في خانة التليفون. اتفحصت
القيم: كلها أسماء («مندوب السياره ( ب )»، «عمرو رجب»…)، ولا واحدة رقم.

**⚠️ الكارت المدموج مابيترجعش.** a5 بيدّي التاجر الواحد كارتين لأن نظامهم بيدّي
حساب ذمم واحد بس: «فلان» للأبيض و«تكنو فلان» للبولي. عندنا اتلمّوا في عميل واحد
بحسابين (`customer_merge_service`)، والكارت البولي اتعطّل. تشغيلة أولى للسكربت ده
رجّعت **٤٨٣ كارت بولي** كعملاء مستقلين وفكّت الدمج — اتقاس: ٤٧٨ من الكروت الباقية
عندها حسابين فعلاً. فالحارس بيقارن بالاسم قبل الإنشاء: «تكنو X» واسمه مطروح منه
البادئة موجود شغّال في نفس الفرع = ده الخط البولي بتاع عميل مدموج، والكارت
مابيتعملش.

**التليفون الحقيقي في `ph3`** — ده العمود اللي فيه الموبايل، ومااتصدّرش خالص في
النقل الأصلي. بيتملا هنا **لو الخانة عندنا فاضية** بس.
"""
from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.customer import Customer
from src.models.org import Branch, Territory
from src.models.role import Role, RoleName
from src.models.user import User

# ملف التصدير → (اسم الفرع عندنا، بادئة الأكواد)
SOURCES = {
    "a5cust_aliaa2026.tsv": ("العلياء", "AL-"),
    "a5cust_Techno2026.tsv": ("أكتوبر", ""),
}

TRADER = "trader"
# البادئة اللي a5 بيعلّم بيها الكارت التاني للراجل الواحد — خط البولي.
TECHNO_PREFIX = "تكنو "
# التصنيفات اللي اتاخدت بقرار في شغل سابق ومابتترجعش لـ«تاجر» أوتوماتيك.
KEEP_TYPES = {"employee", "internal", "showroom", "company", "establishment", "other"}
# دول اللي a5 بيناقضهم صراحةً: هو بيقول تاجر، وإحنا حاطينهم مالك أو سباك.
WRONG_TYPES = {"owner", "plumber"}

PHONE = re.compile(r"^[0-9+()\-\s]{5,}$")
JUNK = re.compile(r"^[\s.\-_0-9@#*/\\]+$")


def _clean(v: str) -> str:
    return " ".join((v or "").split())


def _norm_rep(s: str) -> str:
    """تطبيع أسماء المناديب بس — الهمزة والمسافات جوّه القوسين مختلفة بين المصدرين."""
    s = re.sub(r"[أإآٱ]", "ا", s or "").replace("\xa0", " ")
    return re.sub(r"\s+", "", s).strip()


def _read(path: str) -> list[dict[str, str]]:
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def run(folder: str, *, execute: bool) -> None:
    files = {fn: v for fn, v in SOURCES.items() if os.path.exists(os.path.join(folder, fn))}
    if not files:
        raise SystemExit(f"مافيش ملفات تصدير في {folder}")

    db = SessionLocal()
    try:
        rep_role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        users = db.scalars(select(User)).all()
        rep_by_name = {}
        for u in users:
            if rep_role and u.role_id == rep_role.id:
                rep_by_name.setdefault((u.branch_id, _norm_rep(u.full_name or "")), u)

        all_customers = db.scalars(select(Customer)).all()
        by_code = {c.code: c for c in all_customers if c.code}
        # الاسم جوّه الفرع → الكارت الشغّال. ده اللي بيكشف الخط البولي بتاع عميل
        # مدموج: «تكنو فلان» عند a5 و«فلان» عندنا.
        by_name: dict[tuple[int, str], Customer] = {}
        for c in all_customers:
            if c.active and c.branch_id is not None:
                by_name.setdefault((c.branch_id, _clean(c.name)), c)
        poly: list[tuple[str, str, Customer]] = []
        # الكروت اللي عليها حركة — الحارس اللي بيمنع قفل صف شايل تاريخ.
        busy: set[int] = set()
        for sql in ("SELECT DISTINCT customer_id FROM customer_account",
                    "SELECT DISTINCT customer_id FROM sales_invoice",
                    "SELECT DISTINCT customer_id FROM sales_return",
                    "SELECT DISTINCT customer_id FROM voucher WHERE customer_id IS NOT NULL"):
            busy.update(x[0] for x in db.execute(text(sql)) if x[0] is not None)

        created: list[tuple[str, str]] = []
        updates: list[tuple[Customer, str, object, object]] = []
        notes: Counter = Counter()
        problems: list[str] = []

        for fn, (branch_name, prefix) in files.items():
            rows = _read(os.path.join(folder, fn))
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                problems.append(f"مافيش فرع اسمه «{branch_name}» — {fn} اتخطّى")
                continue
            terrs = {t.name: t for t in db.scalars(
                select(Territory).where(Territory.branch_id == branch.id)).all()}
            fallback = db.scalars(select(Territory).where(
                Territory.branch_id == branch.id).order_by(Territory.id)).first()

            print(f"\n=== {branch_name}: {len(rows)} كارت في a5")
            for r in rows:
                cid, name = r.get("Cust_id", ""), _clean(r.get("name", ""))
                if not cid.isdigit() or not name or JUNK.match(name):
                    notes[f"{branch_name}: صف غير صالح"] += 1
                    continue
                code = f"{prefix}A5-{cid}"
                rep_raw = _clean(r.get("rep", ""))
                rep_user = None
                if rep_raw and not PHONE.match(rep_raw) and rep_raw != "@@":
                    rep_user = rep_by_name.get((branch.id, _norm_rep(rep_raw)))
                    if rep_user is None:
                        notes[f"مندوب a5 مالوش يوزر: {rep_raw}"] += 1

                c = by_code.get(code)
                if name.startswith(TECHNO_PREFIX):
                    twin = by_name.get((branch.id, name[len(TECHNO_PREFIX):].strip()))
                    if twin is not None and (c is None or c.id != twin.id):
                        # الكارت ده الخط البولي بتاع عميل مدموج. مافيش كارت
                        # بيتعمل — ولو تشغيلة قديمة عملته، بيتقفل هنا بنفس علامة
                        # `customer_merge_service` بدل ما يتمسح: المستندات
                        # بتسمّي الصف، والحذف بيحوّلها لرقم محدش يعرف يحلّه.
                        poly.append((code, name, twin))
                        if c is None:
                            notes["الخط البولي لعميل مدموج — مااتعملش كارت"] += 1
                        elif c.active and c.id in busy:
                            # عليه حساب أو مستند — الدمج ده شغل
                            # `customer_merge_service`، مش قفل صف. القفل هنا كان
                            # هيخفي فواتيره من غير ما يحرّك حسابه.
                            problems.append(
                                f"{code} «{c.name}»: خط بولي عليه حركة — محتاج دمج حقيقي")
                        elif c.active:
                            notes["كارت بولي شغّال بالغلط — اتقفل"] += 1
                            updates.append((c, "active", True, False))
                            if "مدموج في #" not in (c.name or ""):
                                updates.append((c, "name", c.name,
                                                f"{c.name} (مدموج في #{twin.id})"))
                            if c.rep_id is not None:
                                updates.append((c, "rep_id", c.rep_id, None))
                        continue
                if c is None:
                    terr = terrs.get(_clean(r.get("area", ""))) or fallback
                    created.append((code, name))
                    if execute:
                        c = Customer(
                            code=code, name=name, customer_type=TRADER,
                            rep_id=rep_user.id if rep_user else None,
                            territory_id=terr.id if terr else None,
                            branch_id=branch.id,
                            phone=(_clean(r.get("ph3", "")) or _clean(r.get("ph_main", "")))[:32]
                            or None,
                            address=_clean(r.get("addr", ""))[:240] or None,
                            active=True)
                        db.add(c)
                        db.flush()
                        by_code[code] = c
                    continue

                # موجود — a5 بيحكم في المندوب والتصنيف وبس.
                ctype = getattr(c.customer_type, "value", c.customer_type)
                if ctype in WRONG_TYPES:
                    updates.append((c, "customer_type", ctype, TRADER))
                elif ctype not in KEEP_TYPES and ctype != TRADER:
                    notes[f"تصنيف غير متوقع: {ctype}"] += 1
                if rep_user is not None and c.rep_id != rep_user.id:
                    updates.append((c, "rep_id", c.rep_id, rep_user.id))
                ph = _clean(r.get("ph3", "")) or _clean(r.get("ph_main", ""))
                if not c.phone and ph:
                    updates.append((c, "phone", None, ph[:32]))
                addr = _clean(r.get("addr", ""))
                if not c.address and addr:
                    updates.append((c, "address", None, addr[:240]))
                if _clean(c.name) != name:
                    notes["الاسم عندنا غير اسم a5 — اتساب"] += 1

        print(f"\n{'كروت هتتعمل (كانت اتمسحت أو جديدة عند a5)':<48}{len(created):>6}")
        for f, n in Counter(f for _, f, _, _ in updates).most_common():
            print(f"{f:<48}{n:>6}")
        for k, v in notes.most_common(12):
            print(f"{k:<48}{v:>6}")

        print(f"{'كروت بولي لعملاء مدموجين — اتسابت':<48}{len(poly):>6}")
        if created:
            print("\n   عيّنة من الجديد:")
            for code, name in created[:10]:
                print(f"      {code:<14} {name}")
        if poly:
            print("\n   عيّنة من الخط البولي (الكارت الباقي شايل الحسابين):")
            for pcode, pname, twin in poly[:6]:
                print(f"      {pcode:<14} «{pname[:26]:<26}» → #{twin.id} «{twin.name[:22]}»")
        if problems:
            print("\nمحتاج مراجعة:")
            for p in problems[:15]:
                print("   ", p)

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for c, field, _, want in updates:
            setattr(c, field, want)
        db.commit()
        print(f"\nاتنفّذ: {len(created)} كارت اتعمل، {len(updates)} حقل اتحدّث. مافيش حذف.")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = "C:/pgtmp/a5cust"
    if "--dir" in args:
        folder = args[args.index("--dir") + 1]
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
