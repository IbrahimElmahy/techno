from __future__ import annotations

import json
import sys
from datetime import datetime

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.a5_link import A5ItemLink
from src.models.catalog import Item
from src.services import audit_service

ELBOW = "تكنو وايت 110"
TEE = "تكنو وايت 114"

RENAME = [
    (2929, "FC-W-02145", "مشترك عاده 114×60 سوبر ابيض", TEE),
    (3517, "FC-W-02144", "مشترك عاده 114×60 ابيض", TEE),
    (2921, "FC-W-02128", "مشترك باب 114×60 سوبر ابيض", TEE),
    (3516, "FC-W-02127", "مشترك باب 114×60 ابيض", TEE),
    (1742, "AL-W-02078", "كوع عاده 60مم سوبر ابيض", ELBOW),
    (3743, "W-02077", "كوع عاده 60مم ابيض", ELBOW),
    (3766, "W-02145", "مشترك عاده 114×60 سوبر ابيض", TEE),
    (3767, "W-02128", "مشترك باب 114×60 سوبر ابيض", TEE),
    (3695, "FC-F-06285", 'تشغيل هوايه 4" 114', "تشغيل"),
]
RELINK = [("", "0030006", 326, 3743)]
NEW = [("AL-W-02077", "كوع عاده 60مم ابيض", ELBOW, 1742, 3743)]
COPY_COLS = ("kind", "unit_of_measure", "piece_name", "pieces_per_unit", "description",
             "default_discount_pct", "is_serialized", "is_perishable", "purchase_discount_pct")


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        actor = db.scalar(text("select id from \"user\" where username = 'admin' limit 1")) \
            or db.scalar(text("select min(id) from \"user\""))
        ids = [r[0] for r in RENAME]
        items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_(ids + [326]))).all()}
        before = [dict(id=i.id, code=i.code, name=i.name, category=i.category, active=i.active)
                  for i in items.values()]
        taken = set(db.scalars(select(Item.code).where(
            Item.code.in_([r[1] for r in RENAME] + [n[0] for n in NEW]),
            Item.id.not_in(ids))).all())
        if taken:
            raise SystemExit(f"أكواد مستخدمة لأصناف تانية: {sorted(taken)}")
        for iid, code, name, cat in RENAME:
            i = items[iid]
            print(f"#{iid} {i.code} «{i.name}»{'' if i.active else ' (موقوف)'} ⇒ {code} «{name}»")
        links = []
        for prefix, a5_code, src, dst in RELINK:
            for ln in db.scalars(select(A5ItemLink).where(
                    A5ItemLink.prefix == prefix, A5ItemLink.a5_code == a5_code,
                    A5ItemLink.item_id == src)).all():
                links.append((ln, dst))
                print(f"ربط a5 {a5_code} «{ln.a5_name}»: #{src} ⇒ #{dst}")
        for code, name, cat, like, price_from in NEW:
            print(f"صنف جديد {code} «{name}» برصيد صفر وأسعار #{price_from}")
        if not execute:
            print("معاينة فقط — شغّل بـ --execute للتنفيذ")
            return

        for iid, *_ in RENAME:
            items[iid].code = f"~S{iid}"
        db.flush()
        for iid, code, name, cat in RENAME:
            i = items[iid]
            i.code, i.name, i.category, i.active = code, name, cat, True
        link_rows = []
        for ln, dst in links:
            link_rows.append(dict(id=ln.id, item_id=ln.item_id))
            ln.item_id = dst
        created = []
        for code, name, cat, like, price_from in NEW:
            base = db.get(Item, like)
            it = Item(code=code, name=name, category=cat, active=True,
                      **{c: getattr(base, c) for c in COPY_COLS})
            src = db.get(Item, price_from)
            it.purchase_price, it.sale_price = src.purchase_price, src.sale_price
            db.add(it)
            db.flush()
            db.execute(text(
                "insert into item_price (item_id, tier, price, discount_pct, vat_pct) "
                "select :n, tier, price, discount_pct, vat_pct from item_price where item_id = :s"),
                {"n": it.id, "s": price_from})
            created.append(it.id)
        db.flush()
        path = f"/opt/backups/split_super_white_{datetime.now():%Y%m%d-%H%M%S}.json"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(dict(items=before, links=link_rows, created=created), fh, ensure_ascii=False)
        audit_service.record(db, action="items.split_super_white", actor_user_id=actor,
                             entity_type="item", entity_id=None,
                             after={"renamed": ids, "created": created, "backup": path})
        db.commit()
        print(f"تم · أصناف جديدة {created} · نسخة الرجوع {path}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--execute" in sys.argv)
