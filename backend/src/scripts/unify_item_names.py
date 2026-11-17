from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

import openpyxl
from sqlalchemy import case, func, select, text

from src.core.db import SessionLocal
from src.models.a5_link import A5ItemLink
from src.models.catalog import Item
from src.models.lookup import LookupOption
from src.models.stock import ItemCostReset, LocationKind, StockDirection, StockMovement
from src.services import audit_service, costing_service

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
    sheet_rows = list(wb["مجمع"].iter_rows(values_only=True))
    head = [_s(h) for h in sheet_rows[0]]
    cat_col = head.index("كود الفئه") if "كود الفئه" in head else 11
    for r in sheet_rows[1:]:
        code = _s(r[0])
        if code and len(r) > cat_col:
            v = r[cat_col]
            master[code.upper()] = cat_names.get(int(v)) if v not in (None, "") else None
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
        odd = [p for p in rest if (p["new_name"] or "") != (main["new_name"] or "")]
        for p in odd:
            report["كود واحد لاسمين مختلفين"].append(dict(p, kept=main["new"]))
        rest = [p for p in rest if p not in odd]
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
    leaving = changing | {p["item"].id for p in [*retire, *held]}
    taken = {code: it.id for code, it in by_code.items() if it.id not in leaving}
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


def _item_refs(db):
    refs = []
    for tbl, col in db.execute(text(
            "select c.conrelid::regclass::text, a.attname from pg_constraint c "
            "join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] "
            "where c.contype = 'f' and c.confrelid = 'item'::regclass order by 1, 2")).all():
        keys = [list(k) for k in db.execute(text(
            "select array(select a.attname from unnest(c.conkey) k "
            "join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) "
            "from pg_constraint c where c.conrelid = cast(:t as regclass) and c.contype = 'u'"),
            {"t": tbl}).scalars().all()]
        refs.append((tbl, col, [k for k in keys if col in k]))
    return refs


PLACEHOLDER = {"item_price": ("price", Decimal("1")), "product_point_value": ("point_value", Decimal("0"))}


def merge_items(db, refs, loser: int, winner: int) -> dict:
    moved, deleted, updated, conflicts = [], [], [], []
    for tbl, col, keys in refs:
        for key in keys:
            others = [k for k in key if k != col]
            cond = " and ".join(f'l."{k}" is not distinct from w."{k}"' for k in others) or "true"
            dups = db.execute(text(
                f'select l.id, row_to_json(l)::text from "{tbl}" l where l."{col}" = :lo and exists '
                f'(select 1 from "{tbl}" w where w."{col}" = :wi and {cond})'),
                {"lo": loser, "wi": winner}).all()
            if dups and tbl == "item_serial":
                raise SystemExit(f"سيريال مكرر بين الصنفين {loser} و{winner} — لم يُحفظ شيء.")
            for row_id, js in dups:
                if tbl in PLACEHOLDER:
                    col_v, floor = PLACEHOLDER[tbl]
                    mine = json.loads(js)
                    where = " and ".join(f'"{k}" = :{k}' for k in others) or "true"
                    w_id, w_val = db.execute(text(
                        f'select id, "{col_v}" from "{tbl}" where "{col}" = :wi and {where}'),
                        {"wi": winner, **{k: mine[k] for k in others}}).first()
                    l_val = Decimal(str(mine[col_v] or 0))
                    w_val = Decimal(str(w_val or 0))
                    kept = w_val
                    if l_val != w_val and w_val <= floor < l_val:
                        db.execute(text(f'update "{tbl}" set "{col_v}" = :v where id = :i'),
                                   {"v": l_val, "i": w_id})
                        updated.append(dict(table=tbl, id=w_id, column=col_v, old=str(w_val)))
                        kept = l_val
                    if l_val != w_val:
                        conflicts.append(dict(table=tbl, key={k: mine[k] for k in others},
                                              loser=str(l_val), winner=str(w_val), kept=str(kept)))
                deleted.append(dict(table=tbl, row=js))
                db.execute(text(f'delete from "{tbl}" where id = :i'), {"i": row_id})
        ids = list(db.execute(text(f'select id from "{tbl}" where "{col}" = :lo'),
                              {"lo": loser}).scalars().all())
        if ids:
            db.execute(text(f'update "{tbl}" set "{col}" = :wi where id = any(:ids)'),
                       {"wi": winner, "ids": ids})
            moved.append(dict(table=tbl, column=col, ids=ids))
    return dict(loser=loser, winner=winner, moved=moved, deleted=deleted, updated=updated,
                conflicts=conflicts)


def apply(db, renames, retire, held, actor: int, backup_path: str, flags, opts, cat_order):
    snapshot = [dict(id=p["item"].id, code=p["item"].code, name=p["item"].name,
                     category=p["item"].category, active=p["item"].active)
                for p in [*renames, *retire, *held]]
    links_moved = []
    for p in retire:
        for ln in db.scalars(select(A5ItemLink).where(A5ItemLink.item_id == p["item"].id)).all():
            links_moved.append(dict(id=ln.id, item_id=ln.item_id))
    lookups = [dict(id=o.id, value=o.value, active=o.active, hidden=o.hidden_in_price_sheet,
                    sort_order=o.sort_order) for o in opts.values()]

    targets = {p["target_code"] for p in renames}
    for p in [*retire, *held]:
        if p["item"].code in targets:
            p["item"].code = f"{p['item'].code}-x{p['item'].id}"[:32]
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
    refs = _item_refs(db)
    groups = defaultdict(set)
    for p in held:
        groups[p["into"]["item"].id].add(p["item"].id)
    signed = case((StockMovement.direction == StockDirection.in_, StockMovement.quantity),
                  else_=-StockMovement.quantity)
    targets = {}
    for winner, losers in groups.items():
        ids = [winner, *losers]
        qty = {i: Decimal(str(q or 0)) for i, q in db.execute(
            select(StockMovement.item_id, func.sum(signed))
            .where(StockMovement.item_id.in_(ids),
                   StockMovement.location_kind == LocationKind.warehouse)
            .group_by(StockMovement.item_id)).all()}
        costs = costing_service.known_costs(db, ids)
        total_q = sum((qty.get(i, Decimal(0)) for i in ids), Decimal(0))
        total_v = sum((qty.get(i, Decimal(0)) * costs.get(i, Decimal(0)) for i in ids), Decimal(0))
        if total_q > 0:
            targets[winner] = total_v / total_q
    merges = []
    for p in held:
        merges.append(merge_items(db, refs, p["item"].id, p["into"]["item"].id))
        p["item"].active = False
    db.flush()
    cost_resets = []
    for winner, unit_cost in targets.items():
        row = ItemCostReset(item_id=winner, effective_date=date.today(), unit_cost=unit_cost,
                            note="توحيد الأصناف: متوسط التكلفة قبل الدمج", actor_user_id=actor)
        db.add(row)
        db.flush()
        cost_resets.append(row.id)
    with open(backup_path, "w", encoding="utf-8") as fh:
        json.dump(dict(items=snapshot, a5_links=links_moved, lookups=lookups, merges=merges,
                       cost_resets=cost_resets),
                  fh, ensure_ascii=False)

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
                                "merged": len(held),
                                "categories_closed": closed, "backup": backup_path})
    return closed, merges


def write_review(path, renames, retire, held, report, by_code, activity, merges=()):
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
    ws = wb.create_sheet("اتدمج")
    ws.append(["الفرع", "الكود", "الاسم", "حركات", "رصيد", "اندمج في", "الاسم الموحد",
               "حركات الأساسي", "رصيد الأساسي"])
    for p in held:
        ws.append([BRANCH_NAMES[p["b"]], p["item"].code, p["item"].name, p["n"], p["bal"],
                   p["into"]["target_code"], p["into"]["target_name"],
                   p["into"]["n"], p["into"]["bal"]])
    ws = wb.create_sheet("أسعار ونقاط مختلفة")
    ws.append(["الصنف الموحد", "الصنف المندمج", "النوع", "الفئة السعرية", "قيمة المندمج",
               "قيمة الموحد", "اللي اتساب"])
    names = {p["item"].id: (p.get("target_code") or p["item"].code, p.get("target_name") or p["item"].name)
             for p in [*renames, *held]}
    for m in merges:
        for c in m.get("conflicts", []):
            ws.append([" ".join(names.get(m["winner"], ("", ""))), " ".join(names.get(m["loser"], ("", ""))),
                       "سعر" if c["table"] == "item_price" else "نقاط", c["key"].get("tier", ""),
                       c["loser"], c["winner"], c["kept"]])
    ws = wb.create_sheet("صنف واحد بكودين")
    ws.append(["الفرع", "الكود", "الاسم", "اتطبق عليه", "الكود التاني في الملف", "اسمه"])
    for r in report.get("صنف واحد بكودين جداد", []):
        ws.append([BRANCH_NAMES[r["b"]], r["item"].code, r["item"].name, r["kept"], r["new"],
                   r["new_name"]])
    ws = wb.create_sheet("ملاحظات تانية")
    ws.append(["النوع", "الفرع", "كود نظامنا", "اسم a5", "الكود الجديد", "الاسم الجديد"])
    for kind in ("كود نظامنا غير موجود", "بدون كود جديد", "الكود الجديد مستخدم لصنف تاني",
                 "كود واحد لاسمين مختلفين"):
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
        for rid in data.get("cost_resets", []):
            db.execute(text("delete from item_cost_reset where id = :i"), {"i": rid})
        for m in reversed(data.get("merges", [])):
            for u in m.get("updated", []):
                db.execute(text(f'update "{u["table"]}" set "{u["column"]}" = :v where id = :i'),
                           {"v": u["old"], "i": u["id"]})
            for mv in m["moved"]:
                db.execute(text(f'update "{mv["table"]}" set "{mv["column"]}" = :lo '
                                f'where id = any(:ids)'), {"lo": m["loser"], "ids": mv["ids"]})
            for d in m["deleted"]:
                db.execute(text(f'insert into "{d["table"]}" select * from '
                                f'json_populate_record(null::"{d["table"]}", cast(:js as json))'),
                           {"js": d["row"]})
        db.flush()
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
                row.sort_order = o.get("sort_order", row.sort_order)
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
            closed, merges = apply(db, renames, retire, held, actor, backup, flags, opts, cat_order)
            print("فئات اتقفلت لأن مافيش صنف عليها:", "، ".join(closed) or "—")
            db.commit()
            print("اتحفظ. نسخة الرجوع:", backup)
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
        write_review(review, renames, retire, held, report, by_code, activity,
                     merges if execute else [])
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
