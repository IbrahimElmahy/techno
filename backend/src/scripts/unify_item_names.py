from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime

import openpyxl
from sqlalchemy import case, func, select

from src.core.db import SessionLocal
from src.models.a5_link import A5ItemLink
from src.models.catalog import Item
from src.models.lookup import LookupOption
from src.models.stock import StockMovement, StockDirection
from src.services import audit_service

SHEETS = {"S": ("أصناف المصنع", "FC-"), "A": ("أصناف العلياء", "AL-"), "O": ("أصناف أكتوبر", "")}
BRANCH_NAMES = {"S": "السادات", "A": "العلياء", "O": "أكتوبر", "P": "مشترك"}
PREFIXES = {"S": "FC-", "A": "AL-", "P": "PR-", "O": ""}


def branch_of_code(code: str) -> str:
    for b, prefix in PREFIXES.items():
        if prefix and code.startswith(prefix):
            return b
    return "O"


CATEGORY = "item_category"


def _s(v) -> str | None:
    if v is None:
        return None
    t = re.sub(r"\s+", " ", str(v)).strip()
    return t or None


def load_file(path: str):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    cat_names = {}
    for r in list(wb["فئات جديده"].iter_rows(values_only=True))[1:]:
        if r[0] is not None and _s(r[1]):
            cat_names[int(r[0])] = _s(r[1])
    master = {}
    for r in list(wb["مجمع"].iter_rows(values_only=True))[1:]:
        code = _s(r[0])
        if code:
            master[code.upper()] = cat_names.get(int(r[11])) if r[11] is not None else None
    rows = []
    for b, (sheet, _) in SHEETS.items():
        for r in list(wb[sheet].iter_rows(values_only=True))[1:]:
            vals = [_s(x) for x in r[:7]]
            a5_code, a5_name, new, new_name, _uom, sheet_cat, ours = vals
            if not new and not ours:
                continue
            rows.append(dict(b=b, a5_code=a5_code, a5_name=a5_name, new=(new or "").upper(),
                             new_name=new_name, sheet_cat=sheet_cat, ours=ours))
    return rows, master, cat_names


def build(db, rows, master):
    by_code = {i.code: i for i in db.scalars(select(Item)).all()}
    signed = case((StockMovement.direction == StockDirection.in_, StockMovement.quantity),
                  else_=-StockMovement.quantity)
    activity = {iid: (n, float(bal or 0)) for iid, n, bal in db.execute(
        select(StockMovement.item_id, func.count(), func.sum(signed))
        .group_by(StockMovement.item_id)).all()}

    report = defaultdict(list)
    first: dict[str, dict] = {}
    for r in rows:
        if not r["new"]:
            report["بدون كود جديد"].append(r)
            continue
        if not r["ours"] or r["ours"] == "مش موجود":
            continue
        item = by_code.get(r["ours"])
        if item is None:
            report["كود نظامنا غير موجود"].append(r)
            continue
        if item.code in first:
            if first[item.code]["new"] != r["new"]:
                report["صنف واحد بكودين جداد"].append(
                    dict(r, item=item, kept=first[item.code]["new"]))
            continue
        n, bal = activity.get(item.id, (0, 0.0))
        first[item.code] = dict(r, item=item, n=n, bal=bal, sheet_b=r["b"],
                                b=branch_of_code(item.code))

    groups = defaultdict(list)
    for p in first.values():
        groups[(p["b"], p["new"])].append(p)

    renames, retire, held = [], [], []
    for (b, new), members in groups.items():
        members.sort(key=lambda p: (-p["n"], -abs(p["bal"]), p["item"].id))
        main, rest = members[0], members[1:]
        renames.append(main)
        if not rest:
            continue
        if all(p["n"] == 0 for p in rest):
            for p in rest:
                retire.append(dict(p, into=main))
        else:
            for p in rest:
                if p["n"] == 0:
                    retire.append(dict(p, into=main))
                else:
                    held.append(dict(p, into=main))

    changing = {p["item"].id for p in renames}
    for p in renames:
        prefix = PREFIXES[p["b"]]
        p["target_code"] = f"{prefix}{p['new']}"
        p["target_name"] = p["new_name"] or p["item"].name
        p["target_cat"] = master.get(p["new"]) or p["sheet_cat"] or p["item"].category
    taken = {code: it.id for code, it in by_code.items() if it.id not in changing}
    ok = []
    for p in renames:
        other = taken.get(p["target_code"])
        if other is not None and other != p["item"].id:
            report["الكود الجديد مستخدم لصنف تاني"].append(p)
            continue
        ok.append(p)
    return ok, retire, held, report, by_code, activity


def price_sheet_flags(db, renames):
    opts = {o.value: o for o in db.scalars(
        select(LookupOption).where(LookupOption.category == CATEGORY)).all()}
    hidden_of_new = defaultdict(list)
    for p in renames:
        old = opts.get(p["item"].category or "")
        hidden_of_new[p["target_cat"]].append(bool(old.hidden_in_price_sheet) if old else False)
    return {cat: sum(v) * 2 > len(v) for cat, v in hidden_of_new.items()}, opts


def apply(db, renames, retire, actor: int, backup_path: str, flags, opts, cat_order):
    snapshot = [dict(id=p["item"].id, code=p["item"].code, name=p["item"].name,
                     category=p["item"].category, active=p["item"].active)
                for p in [*renames, *retire]]
    links_moved = []
    for p in retire:
        for ln in db.scalars(select(A5ItemLink).where(A5ItemLink.item_id == p["item"].id)).all():
            links_moved.append(dict(id=ln.id, item_id=ln.item_id))
    with open(backup_path, "w", encoding="utf-8") as fh:
        json.dump(dict(items=snapshot, a5_links=links_moved,
                       lookups=[dict(id=o.id, value=o.value, active=o.active,
                                     hidden=o.hidden_in_price_sheet) for o in opts.values()]),
                  fh, ensure_ascii=False)

    for p in renames:
        p["item"].code = f"~U{p['item'].id}"
    db.flush()
    for p in renames:
        it = p["item"]
        it.code = p["target_code"]
        it.name = p["target_name"][:160]
        it.category = (p["target_cat"] or "")[:80] or None
    for p in retire:
        p["item"].active = False
        for ln in db.scalars(select(A5ItemLink).where(A5ItemLink.item_id == p["item"].id)).all():
            ln.item_id = p["into"]["item"].id
    db.flush()

    last = max((o.sort_order for o in opts.values()), default=0)
    for i, cat in enumerate(cat_order, start=1):
        o = opts.get(cat)
        if o is None:
            o = LookupOption(category=CATEGORY, value=cat, label=cat, sort_order=last + i,
                             active=True, is_system=False)
            db.add(o)
            opts[cat] = o
        o.active = True
        o.sort_order = i
        if cat in flags:
            o.hidden_in_price_sheet = flags[cat]
    db.flush()
    in_use = {c for c in db.scalars(select(Item.category).where(
        Item.active.is_(True), Item.category.is_not(None)).distinct()).all()}
    closed = []
    for value, o in opts.items():
        if o.active and value not in in_use and value not in cat_order:
            o.active = False
            closed.append(value)
    db.flush()
    audit_service.record(db, action="items.unify_names", actor_user_id=actor,
                         entity_type="item", entity_id=None,
                         after={"renamed": len(renames), "retired": len(retire),
                                "categories_closed": closed, "backup": backup_path})
    return closed


def write_review(path, renames, retire, held, report, by_code, activity):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "اتطبق"
    ws.append(["الفرع", "الكود القديم", "الاسم القديم", "الفئة القديمة",
               "الكود الجديد", "الاسم الجديد", "الفئة الجديدة", "عدد الحركات", "الرصيد"])
    for p in renames:
        it = p["item"]
        ws.append([BRANCH_NAMES[p["b"]], p.get("old_code", it.code), p.get("old_name", it.name),
                   p.get("old_cat", it.category), p["target_code"], p["target_name"],
                   p["target_cat"], p["n"], p["bal"]])
    ws = wb.create_sheet("اتوقف (مكرر مالوش حركة)")
    ws.append(["الفرع", "الكود", "الاسم", "اتوقف لصالح", "الاسم الموحد"])
    for p in retire:
        ws.append([BRANCH_NAMES[p["b"]], p["item"].code, p["item"].name,
                   p["into"]["target_code"], p["into"]["target_name"]])
    ws = wb.create_sheet("دمج محتاج قرار")
    ws.append(["الفرع", "الكود", "الاسم", "حركات", "رصيد", "المفروض يندمج في", "الاسم الموحد",
               "حركات الأساسي", "رصيد الأساسي"])
    for p in held:
        ws.append([BRANCH_NAMES[p["b"]], p["item"].code, p["item"].name, p["n"], p["bal"],
                   p["into"]["target_code"], p["into"]["target_name"],
                   p["into"]["n"], p["into"]["bal"]])
    ws = wb.create_sheet("صنف واحد بكودين")
    ws.append(["الفرع", "الكود", "الاسم", "اتطبق عليه", "الكود التاني في الملف", "اسمه"])
    for r in report.get("صنف واحد بكودين جداد", []):
        ws.append([BRANCH_NAMES[r["b"]], r["item"].code, r["item"].name, r["kept"], r["new"],
                   r["new_name"]])
    ws = wb.create_sheet("ملاحظات تانية")
    ws.append(["النوع", "الفرع", "كود نظامنا", "اسم a5", "الكود الجديد", "الاسم الجديد"])
    for kind in ("كود نظامنا غير موجود", "بدون كود جديد", "الكود الجديد مستخدم لصنف تاني"):
        for r in report.get(kind, []):
            ws.append([kind, BRANCH_NAMES[r["b"]], r.get("ours"), r.get("a5_name"), r.get("new"),
                       r.get("new_name")])
    ws = wb.create_sheet("مش في الملف وعليه حركة")
    ws.append(["الفرع", "الكود", "الاسم", "الفئة", "حركات", "الرصيد"])
    covered = {p["item"].id for p in [*renames, *retire, *held]}
    for it in by_code.values():
        if it.id in covered or it.code.startswith("~U"):
            continue
        n, bal = activity.get(it.id, (0, 0.0))
        if not n:
            continue
        b = "S" if it.code.startswith("FC-") else "A" if it.code.startswith("AL-") else \
            None if it.code.startswith("PR-") else "O"
        if b:
            ws.append([BRANCH_NAMES[b], it.code, it.name, it.category, n, bal])
    for sheet in wb.worksheets:
        sheet.sheet_view.rightToLeft = True
    wb.save(path)


def restore(backup: str, actor: int) -> None:
    data = json.load(open(backup, encoding="utf-8"))
    db = SessionLocal()
    try:
        rows = {r["id"]: r for r in data["items"]}
        items = db.scalars(select(Item).where(Item.id.in_(list(rows)))).all()
        for it in items:
            it.code = f"~R{it.id}"
        db.flush()
        for it in items:
            r = rows[it.id]
            it.code, it.name, it.category, it.active = r["code"], r["name"], r["category"], r["active"]
        for ln in data["a5_links"]:
            row = db.get(A5ItemLink, ln["id"])
            if row is not None:
                row.item_id = ln["item_id"]
        keep = {o["id"] for o in data["lookups"]}
        for o in data["lookups"]:
            row = db.get(LookupOption, o["id"])
            if row is not None:
                row.active, row.hidden_in_price_sheet = o["active"], o["hidden"]
        for row in db.scalars(select(LookupOption).where(LookupOption.category == CATEGORY)).all():
            if row.id not in keep:
                db.delete(row)
        db.flush()
        audit_service.record(db, action="items.unify_names_restore", actor_user_id=actor,
                             entity_type="item", entity_id=None, after={"backup": backup})
        db.commit()
        print(f"اترجع {len(items)} صنف من {backup}")
    finally:
        db.close()


def run(path: str, *, execute: bool, actor: int, review: str, backup: str) -> None:
    rows, master, cat_names = load_file(path)
    db = SessionLocal()
    try:
        renames, retire, held, report, by_code, activity = build(db, rows, master)
        for p in [*renames, *retire]:
            p["old_code"], p["old_name"], p["old_cat"] = (
                p["item"].code, p["item"].name, p["item"].category)
        flags, opts = price_sheet_flags(db, renames)
        cat_order = [cat_names[k] for k in sorted(cat_names)]
        print(f"تغيير اسم وكود: {len(renames)} · توقيف مكرر مالوش حركة: {len(retire)} "
              f"· دمج محتاج قرار: {len(held)}")
        for k, v in report.items():
            print(f"  {k}: {len(v)}")
        for cat in cat_order:
            print(f"  فئة {cat}: {'مخفية' if flags.get(cat) else 'ظاهرة'} في كشف الأسعار")
        if execute:
            closed = apply(db, renames, retire, actor, backup, flags, opts, cat_order)
            print("فئات اتقفلت لأن مافيش صنف عليها:", "، ".join(closed) or "—")
            db.commit()
            print("اتحفظ. نسخة الرجوع:", backup)
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
        write_review(review, renames, retire, held, report, by_code, activity)
        print("ملف المراجعة:", review)
    finally:
        db.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts_ = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    if "restore" in opts_:
        restore(opts_["restore"], int(opts_.get("actor", 1)))
        sys.exit(0)
    run(args[0], execute="--yes" in sys.argv, actor=int(opts_.get("actor", 1)),
        review=opts_.get("review", f"unify_review_{stamp}.xlsx"),
        backup=opts_.get("backup", f"unify_backup_{stamp}.json"))
