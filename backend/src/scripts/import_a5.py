"""يستورد البيانات الأساسية من نظام a5 — نسخ، مش نقل.

بيقرا ملفات مصدّرة من قاعدة a5 على SQL Server (`a5_*.tsv`) وبيكتبها في قاعدتنا. **مابيلمسش
a5 خالص** — لا قراءة مباشرة ولا اتصال؛ الملفات بتتصدّر بأمر منفصل، والسكربت ده بيقرا ملفات
على القرص وبس.

    python -m src.scripts.import_a5 --dir C:/pgtmp            # يعرض بس
    python -m src.scripts.import_a5 --dir C:/pgtmp --yes      # ينفّذ

    # شركة تانية على فرع تاني، بأكوادها لوحدها:
    python -m src.scripts.import_a5 --dir C:/aliaa --branch العلياء --prefix AL- --yes

بيتعاد تشغيله بأمان: المطابقة بالاسم، والموجود بيتحدّث والناقص بيتعمل. تشغيلتين ورا بعض
بيدّوا نفس النتيجة.

---------------------------------------------------------------------------
قرارات الترجمة — كل واحد فيهم لأن الشكلين مش واحد:

* **المناطق مستويين بالاسم عندهم، بمفتاح عندنا.** `Areas.Father_n` نص مكرر على كل صف؛
  إحنا بنعمل المنطقة الأب مرة واحدة وبنشاور عليها. والأسماء المكررة بتتجمّع في واحدة.

* **العميل بيتربط بمنطقته بالاسم عندهم.** بنطابق `Cust.area_name` + `Father_n` على المنطقة
  اللي اتعملت، فالربط بيبقى مفتاح — وتغيير اسم المنطقة بعدين مايكسرش حاجة.

* **الأسعار الخمسة بتتحول لشرايح.** `item_price1..5` عندهم أعمدة على الصنف؛ عندنا صفوف في
  `item_price` بفئة لكل شريحة. الصفر مابيتكتبش: سعر صفر مش سعر، هو غياب سعر.

* **كل شركة كتالوجها لوحده.** a5 عنده قاعدة لكل شركة، والكود جوّه كل قاعدة عدّاد بيبدأ
  من الأول. `0020001` في أكتوبر «تى لحام معزول ٣٢» وفي العلياء «تى ١"×٣/٤ بسن داخلي» —
  ١٨٠ كود مشترك ومش نفس الصنف. فالبادئة (`--prefix`) بتفصلهم، والبحث عن الموجود بيتقيّد
  بالبادئة كمان: من غير كده الاستيراد التاني بيلاقي صنف أكتوبر بنفس الاسم وبيكتب عليه سعر
  العلياء.

* **البيانات الوسخة بتتخطى وبتتقال.** لقينا في a5 مناطق اسمها «.» و«0» و«@@@» وأصناف
  «@@صنف تجريبى». اللي اسمه رمز أو رقم بس بيتسجّل في تقرير التخطي — مابيتشالش في صمت
  ومابيتستوردش كأنه بيانات.
"""
from __future__ import annotations

import os
import re
import sys
from decimal import Decimal, InvalidOperation

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item, ItemKind, ItemPrice, PriceTier
from src.models.customer import Customer
from src.models.org import Branch, Territory
from src.models.supplier import Supplier
from src.models.warehouse import Warehouse, WarehouseType

# اسم من دول مش اسم — رمز أو رقم اتكتب في خانة الاسم.
JUNK = re.compile(r"^[\s.\-_0-9@#*/\\]+$")

# رقم فعلاً: أرقام ومسافات وعلامات الهاتف وبس. اللي فيه حروف اسم مش رقم.
PHONE = re.compile(r"^[0-9+()\-\s]{5,}$")

# ترتيب الشرايح زي ما هي في `item_price1..5`.
TIERS = [PriceTier.commercial, PriceTier.semi_commercial, PriceTier.wholesale,
         PriceTier.semi_wholesale, PriceTier.consumer]


def _read(path: str) -> list[list[str]]:
    """يقرا ملف مصدّر من sqlcmd — UTF-16 بفاصل ~."""
    if not os.path.exists(path):
        return []
    raw = open(path, "rb").read()
    txt = (raw.decode("utf-16", errors="replace")
           if raw[:2] in (b"\xff\xfe", b"\xfe\xff")
           else raw.decode("utf-8", errors="replace"))
    out = []
    for line in txt.splitlines():
        if not line.strip():
            continue
        out.append([c.strip() for c in line.split("~")])
    return out


def _money(v: str) -> Decimal:
    try:
        return Decimal((v or "0").strip() or "0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _clean(v: str) -> str:
    return " ".join((v or "").split())


class Report:
    def __init__(self) -> None:
        self.made: dict[str, int] = {}
        self.seen: dict[str, int] = {}
        self.skipped: list[str] = []

    def add(self, kind: str, created: bool) -> None:
        self.seen[kind] = self.seen.get(kind, 0) + 1
        if created:
            self.made[kind] = self.made.get(kind, 0) + 1

    def skip(self, why: str) -> None:
        self.skipped.append(why)

    def show(self) -> None:
        print(f"\n{'الكيان':<16}{'موجود/اتعمل':>14}{'اتعمل جديد':>12}")
        print("-" * 44)
        for k in sorted(self.seen):
            print(f"{k:<16}{self.seen[k]:>14}{self.made.get(k, 0):>12}")
        if self.skipped:
            print(f"\nاتخطّى {len(self.skipped)} صف:")
            for s in self.skipped[:15]:
                print("   ", s)
            if len(self.skipped) > 15:
                print(f"    … و{len(self.skipped) - 15} غيرهم")


def run(folder: str, *, execute: bool, branch_name: str = "", prefix: str = "") -> None:
    rep = Report()
    cats = _read(os.path.join(folder, "a5_cats.tsv"))
    items = _read(os.path.join(folder, "a5_items.tsv"))
    custs = _read(os.path.join(folder, "a5_cust.tsv"))
    misc = _read(os.path.join(folder, "a5_misc.tsv"))

    print("المصدر:")
    for name, rows in (("فئات", cats), ("أصناف", items),
                       ("عملاء", custs), ("مناطق/مخازن/موردين", misc)):
        print(f"   {name:<22}{len(rows):>6} صف")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit(f"مافيش فرع اسمه «{branch_name}».")
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        if branch is None:
            raise SystemExit("مافيش فرع نشط — اعمل فرع الأول.")
        print(f"\nالفرع المستهدف: {branch.name}"
              + (f" · البادئة: {prefix}" if prefix else "") + "\n")

        # ---------- المناطق: الأب الأول، وبعده اللي تحته ----------
        areas = [r for r in misc if r and r[0] == "AREA"]
        # المنطقة بتتدوّر جوّه الفرع بس: «الجيزة» في أكتوبر و«الجيزة» في العلياء منطقتين،
        # ولو الدورة عامة عملاء العلياء بيقعدوا على منطقة أكتوبر وبالتالي على فرعها.
        by_name = {t.name: t for t in db.scalars(
            select(Territory).where(Territory.branch_id == branch.id)).all()}

        def territory(name: str, parent: Territory | None = None) -> Territory | None:
            name = _clean(name)
            if not name or JUNK.match(name):
                return None
            t = by_name.get(name)
            if t is None:
                t = Territory(name=name, branch_id=branch.id,
                              parent_id=parent.id if parent else None)
                db.add(t)
                db.flush()
                by_name[name] = t
                rep.add("مناطق", True)
            else:
                if parent is not None and t.parent_id is None and t.id != parent.id:
                    t.parent_id = parent.id
                rep.add("مناطق", False)
            return t

        for r in areas:
            father, child = (r[2] if len(r) > 2 else ""), (r[3] if len(r) > 3 else "")
            if JUNK.match(_clean(child) or "."):
                rep.skip(f"منطقة باسم غير صالح: «{child}»")
                continue
            p = territory(father) if _clean(father) and _clean(father) != _clean(child) else None
            territory(child, p)
        db.flush()

        # ---------- المخازن ----------
        wh_by_name = {w.name: w for w in db.scalars(
            select(Warehouse).where(Warehouse.branch_id == branch.id)).all()}
        for r in [x for x in misc if x and x[0] == "STORE"]:
            name = _clean(r[2] if len(r) > 2 else "")
            if not name or JUNK.match(name):
                rep.skip(f"مخزن باسم غير صالح: «{name}»")
                continue
            if name in wh_by_name:
                rep.add("مخازن", False)
                continue
            w = Warehouse(name=name, warehouse_type=WarehouseType.branch,
                          branch_id=branch.id, active=True)
            db.add(w)
            wh_by_name[name] = w
            rep.add("مخازن", True)
        db.flush()

        # ---------- الموردين ----------
        sup_by_name = {s.name: s for s in db.scalars(select(Supplier)).all()}
        for r in [x for x in misc if x and x[0] == "SUPP"]:
            name = _clean(r[2] if len(r) > 2 else "")
            if not name or JUNK.match(name):
                rep.skip(f"مورد باسم غير صالح: «{name}»")
                continue
            if name in sup_by_name:
                rep.add("موردين", False)
                continue
            # الكود إجباري وفريد — بيتولّد من رقم المورد في a5.
            s = Supplier(code=f"{prefix}A5-{r[1]}", name=name,
                         phone=_clean(r[3])[:32] or None,
                         address=_clean(r[4])[:240] or None, active=True)
            db.add(s)
            sup_by_name[name] = s
            rep.add("موردين", True)
        db.flush()

        # ---------- الأصناف وشرايحها ----------
        cat_names = {int(r[0]): _clean(r[1]) for r in cats if r and r[0].isdigit()}
        # الكتالوج بيتقسّم بالبادئة. من غير كده «كوع ٢٥ لحام» بتاع العلياء بيلاقي صنف
        # أكتوبر بنفس الاسم وبيكتب عليه أسعار العلياء.
        all_items = db.scalars(select(Item)).all()
        mine = [i for i in all_items if not prefix or (i.code or "").startswith(prefix)]
        item_by_code = {i.code: i for i in mine if i.code}
        item_by_name = {i.name: i for i in mine}
        taken_codes = {i.code for i in all_items if i.code}
        for r in items:
            if len(r) < 12 or not r[0].isdigit():
                continue
            code, name = _clean(r[2]), _clean(r[3])
            if not name or JUNK.match(name):
                rep.skip(f"صنف باسم غير صالح: «{name}» (كود {code})")
                continue
            it = item_by_code.get(f"{prefix}{code}") or item_by_name.get(name)
            created = it is None
            if it is None:
                # الكود إجباري وفريد عندنا. a5 عنده أصناف بلا كود، فبيتولّد من رقمه
                # هناك — رقم أصلي ثابت، أحسن من عدّاد بيتغيّر لو الاستيراد اتعاد.
                base = f"{prefix}{code}" if code else f"{prefix}A5-{r[0]}"
                use, n = base, 2
                while use in taken_codes:
                    use = f"{base}-{n}"
                    n += 1
                taken_codes.add(use)
                it = Item(code=use, name=name, kind=ItemKind.product,
                          category=cat_names.get(int(r[1] or 0)) or None,
                          unit_of_measure=_clean(r[4]) or "قطعة",
                          sale_price=_money(r[5]), active=True)
                db.add(it)
                db.flush()
                item_by_code[it.code] = it
                item_by_name[name] = it
            rep.add("أصناف", created)

            # الشرايح الخمسة. الصفر مابيتكتبش — سعر صفر غياب سعر مش سعر.
            have = {p.tier: p for p in db.scalars(
                select(ItemPrice).where(ItemPrice.item_id == it.id)).all()}
            for idx, tier in enumerate(TIERS):
                price = _money(r[5 + idx])
                if price <= 0:
                    continue
                if tier in have:
                    have[tier].price = price
                    rep.add("شرايح أسعار", False)
                else:
                    db.add(ItemPrice(item_id=it.id, tier=tier, price=price))
                    rep.add("شرايح أسعار", True)
        db.flush()

        # ---------- العملاء ----------
        #
        # العميل عندنا لازم يبقى له مندوب ومنطقة. a5 مش بيلزم بده — `Emp_Bos` فاضي في
        # الـ٦٥٠ عميل كلهم. فبنحطهم على مندوب واحد ومنطقة واحدة، ومن شاشة المناديب
        # بيتوزّعوا. الاختيار ده مقصود: عميل على مندوب غلط بيتنقل بضغطة، وعميل مااتستوردش
        # بيفضل ناقص.
        from src.models.role import Role, RoleName
        from src.models.user import User

        rep_role = db.scalars(select(Role).where(Role.name == RoleName.sales_rep)).first()
        default_rep = db.scalars(
            select(User).where(User.role_id == rep_role.id, User.branch_id == branch.id)
            .order_by(User.id)).first() if rep_role else None
        if default_rep is None and rep_role is not None:
            default_rep = db.scalars(select(User).where(User.role_id == rep_role.id)
                                     .order_by(User.id)).first()
        if default_rep is None:
            default_rep = db.scalars(select(User).order_by(User.id)).first()
        fallback_terr = db.scalars(select(Territory).where(
            Territory.branch_id == branch.id).order_by(Territory.id)).first()
        if fallback_terr is None:
            fallback_terr = Territory(name="غير محددة", branch_id=branch.id)
            db.add(fallback_terr)
            db.flush()
        print(f"العملاء بيتحطوا مؤقتاً على: {default_rep.username} / {fallback_terr.name}")

        # مناديبنا بالاسم — عشان اللي مكتوب في a5 يتطابق على مندوب حقيقي.
        rep_by_name: dict[str, int] = {}
        if rep_role:
            for u in db.scalars(select(User).where(User.role_id == rep_role.id,
                                                   User.branch_id == branch.id)).all():
                for key in filter(None, {_clean(u.full_name or ""), u.username}):
                    rep_by_name[key] = u.id
        unmatched_reps: dict[str, int] = {}

        cust_by_name = {c.name: c for c in db.scalars(
            select(Customer).where(Customer.branch_id == branch.id)).all()}
        for r in custs:
            if len(r) < 8 or not r[0].isdigit():
                continue
            name = _clean(r[1])
            if not name or JUNK.match(name):
                rep.skip(f"عميل باسم غير صالح: «{name}»")
                continue
            terr = by_name.get(_clean(r[3])) or by_name.get(_clean(r[2])) or fallback_terr
            c = cust_by_name.get(name)
            created = c is None
            if c is None:
                # الكود والمندوب والمنطقة إجباريين عندنا وa5 مش لازم يبقى عنده الترتيب
                # ده. الكود بيتولّد من رقمه الأصلي، والمندوب بيتساب على حساب مؤقت لحد ما
                # يتوزّعوا من شاشة المناديب — أحسن من إننا نخترع مندوب لكل عميل.
                c = Customer(code=f"{prefix}A5-{r[0]}", name=name, customer_type="trader",
                             rep_id=default_rep.id, territory_id=terr.id,
                             branch_id=terr.branch_id, active=True)
                db.add(c)
                cust_by_name[name] = c
            # `ph1` مش تليفون — هو **اسم المندوب**.
            #
            # a5 عنده عمود مخصص للمندوب (`Emp_Bos`) وهو فاضي في الـ٦٥٠ عميل كلهم، واللي
            # بيدخّل البيانات بيكتب اسم المندوب في خانة التليفون. فحصنا القيم كلها: صفر
            # منها رقم، والـ٦٥٠ أسماء («عمرو رجب»، «مندوبية الفيوم»…).
            #
            # فبتتحط في مكانها. نسخها كتليفون بتدّي ٦٤٩ عميل بأرقام مالهاش وجود —
            # والمندوب يفضل ضايع، وهو المعلومة الحقيقية اللي جوّه الخانة.
            raw = _clean(r[4])
            if raw and PHONE.match(raw):
                c.phone = raw[:32]
            elif raw:
                rid = rep_by_name.get(raw)
                if rid:
                    c.rep_id = rid
                    rep.add("عملاء بمندوب", True)
                else:
                    unmatched_reps[raw] = unmatched_reps.get(raw, 0) + 1
            c.address = _clean(r[5])[:240] or c.address
            if terr is not None:
                c.territory_id = terr.id
                c.branch_id = terr.branch_id
            rep.add("عملاء", created)
        db.flush()

        db.commit()
        rep.show()
        if unmatched_reps:
            print("")
            print("أسماء مناديب في a5 مالهاش حساب عندنا — العملاء دول محتاجين توزيع:")
            for nm, cnt in sorted(unmatched_reps.items(), key=lambda x: -x[1]):
                print(f"    {nm:<26}{cnt:>5} عميل")
            print("  اعمل لهم حسابات من «المستخدمين» ووزّعهم من شاشة «المناديب».")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = "C:/pgtmp"
    if "--dir" in args:
        folder = args[args.index("--dir") + 1]
    branch = args[args.index("--branch") + 1] if "--branch" in args else ""
    prefix = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    run(folder, execute="--yes" in args, branch_name=branch, prefix=prefix)
