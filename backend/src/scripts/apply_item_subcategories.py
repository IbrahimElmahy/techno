from __future__ import annotations

import json
import re
import sys
from collections import Counter

import openpyxl
from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.lookup import LookupOption
from src.services import audit_service

CATEGORY = "item_category"
CODE = re.compile(r"^(FC-|AL-|PR-)?([A-Z]-\d{5})$")
BRANCH_COL = {"FC-": "فئه مصنع", "AL-": "فئه العلياء", "": "فئه أكتوبر"}


def _s(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else None


def run(path: str, *, execute: bool, actor: int, backup: str) -> None:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    cats = {r[0]: _s(r[1]) for r in list(wb["فئات جديده"].iter_rows(values_only=True))[1:] if r[0]}
    rows = list(wb["مجمع"].iter_rows(values_only=True))
    head = [_s(h) or "" for h in rows[0]]
    ci = head.index("كود الفئه")
    master = {}
    for r in rows[1:]:
        if not r[0]:
            continue
        d = dict(zip(head, r))
        master[_s(r[0]).upper()] = (cats.get(r[ci]), {k: _s(d.get(v)) for k, v in BRANCH_COL.items()})

    db = SessionLocal()
    try:
        changes, parent_of = [], {}
        for it in db.scalars(select(Item)).all():
            m = CODE.match(it.code or "")
            if not m:
                continue
            prefix, code = m.group(1) or "", m.group(2)
            if code not in master:
                continue
            main, by_branch = master[code]
            if prefix == "PR-":
                want = next((v for v in by_branch.values() if v), None) or main
            else:
                want = by_branch.get(prefix) or main
            if not want:
                continue
            if main and want != main and want not in cats.values():
                parent_of[want] = main
            if want != (it.category or None):
                changes.append((it, it.category, want))
        print(f"أصناف هتتغير فئتها: {len(changes)}")
        for (old, new), n in Counter((o, w) for _, o, w in changes).most_common(20):
            print(f"  {old} ← {new}: {n}")
        opts = {o.value: o for o in db.scalars(
            select(LookupOption).where(LookupOption.category == CATEGORY)).all()}
        before = {v: dict(id=o.id, active=o.active, parent=o.parent_value, hidden=o.hidden_in_price_sheet)
                  for v, o in opts.items()}
        json.dump(dict(items=[dict(id=i.id, category=o) for i, o, _ in changes], lookups=before),
                  open(backup, "w", encoding="utf-8"), ensure_ascii=False)
        for it, _, new in changes:
            it.category = new[:80]
        last = max((o.sort_order for o in opts.values()), default=0)
        for i, (sub, main) in enumerate(sorted(parent_of.items()), start=1):
            o = opts.get(sub)
            if o is None:
                o = LookupOption(category=CATEGORY, value=sub, label=sub, sort_order=last + i,
                                 active=True, is_system=False)
                db.add(o)
            o.active = True
            o.parent_value = None
            print(f"  فئة جديدة: {sub}")
        db.flush()
        audit_service.record(db, action="items.subcategories", actor_user_id=actor,
                             entity_type="item", entity_id=None,
                             after={"changed": len(changes), "backup": backup})
        if execute:
            db.commit()
            print("اتحفظ. نسخة الرجوع:", backup)
        else:
            db.rollback()
            print("تجربة فقط — أضف --yes للحفظ.")
    finally:
        db.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts_ = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    run(args[0], execute="--yes" in sys.argv, actor=int(opts_.get("actor", 1)),
        backup=opts_.get("backup", "subcategories_backup.json"))
