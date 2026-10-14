from __future__ import annotations

import csv
import os
import re
import sys
from collections import Counter, defaultdict

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.coupon_receipt import CouponReceipt
from src.models.customer import Customer
from src.scripts.wb_profile import OCTOBER
from src.services import audit_service, coupon_receipt_service


def _norm(text: str | None) -> str:
    t = (text or "").replace("فنى", "").replace("فني", "")
    t = re.sub("[أإآ]", "ا", t).replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"\s+", " ", t).strip()


def _same(a: str | None, b: str | None) -> bool:
    x, y = _norm(a), _norm(b)
    return bool(x) and bool(y) and (x == y or x in y or y in x)


def run(folder: str, execute: bool) -> None:
    with open(os.path.join(folder, "coupons.tsv"), encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    by_receipt: dict[str, set] = defaultdict(set)
    for r in rows:
        rc = (r.get("code_receipt") or "").strip()
        if rc and rc != "0":
            by_receipt[rc].add((r.get("plumber_code", "").strip(), r.get("plumber_name", ""),
                                r.get("trader_code_raw", "").strip()))
    db = SessionLocal()
    try:
        custs = {c.code: c for c in db.scalars(select(Customer).where(
            Customer.code.like(f"{OCTOBER.plumber_prefix}%")
            | Customer.code.like(f"{OCTOBER.a5_prefix}%"))).all()}
        by_id = {c.id: c for c in custs.values()}

        def follow(c: Customer | None) -> Customer | None:
            mark = "(مدموج في #"
            if c is None or c.active or mark not in (c.name or ""):
                return c
            try:
                keep = int(c.name.split(mark, 1)[1].split(")", 1)[0])
            except ValueError:
                return c
            return by_id.get(keep) or db.get(Customer, keep) or c

        receipts = db.scalars(select(CouponReceipt).where(
            CouponReceipt.document_number.like(f"{OCTOBER.receipt_prefix}%"),
            CouponReceipt.customer_id.is_(None))).all()
        stats: Counter = Counter()
        skipped = []
        for rec in receipts:
            code = rec.document_number[len(OCTOBER.receipt_prefix):]
            found = by_receipt.get(code) or set()
            if len({x[0] for x in found}) != 1:
                stats["أكثر من مستلم أو غير موجود في الملف"] += 1
                skipped.append((rec.document_number, "multi"))
                continue
            pc, pn, tc = next(iter(found))
            target = None
            if pc and pc == tc:
                target, how = follow(custs.get(OCTOBER.a5_prefix + pc)), "التاجر نفسه"
            elif pc and pc.isdigit() and _same(
                    (custs.get(OCTOBER.plumber_prefix + pc) or Customer(name="")).name, pn):
                target, how = custs.get(OCTOBER.plumber_prefix + pc), "سباك بالكود"
            elif pc and _same((custs.get(OCTOBER.a5_prefix + pc) or Customer(name="")).name, pn):
                target, how = follow(custs.get(OCTOBER.a5_prefix + pc)), "تاجر آخر بالكود"
            if target is None:
                stats["بلا مطابقة"] += 1
                skipped.append((rec.document_number, pc, pn))
                continue
            stats[how] += 1
            if not execute:
                continue
            before = {"customer_id": None, "customer_type": rec.customer_type, "notes": rec.notes}
            rec.customer_id = target.id
            rec.customer_type = coupon_receipt_service.receiver_side_of(
                getattr(target.customer_type, "value", target.customer_type), rec.customer_type)
            rec.notes = coupon_receipt_service.strip_receiver_note(rec.notes)
            audit_service.record(
                db, action="coupon_receipt.link_receiver", actor_user_id=None,
                entity_type="coupon_receipt", entity_id=rec.id, before=before,
                after={"customer_id": rec.customer_id, "customer_type": rec.customer_type,
                       "notes": rec.notes})
        print(f"استلامات أكتوبر بلا مستلم: {len(receipts)}")
        for k, v in stats.most_common():
            print(f"   {k:<40}{v}")
        for s in skipped[:15]:
            print("   تُخطّى:", *s)
        if execute:
            db.commit()
            print("✔ اتربطت")
        else:
            print("تجربة فقط — أضف --yes للتنفيذ")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else OCTOBER.default_dir
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
