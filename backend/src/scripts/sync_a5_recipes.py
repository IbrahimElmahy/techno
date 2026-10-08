from __future__ import annotations

import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_qty
from src.models.bom import Bom, BomComponent
from src.models.catalog import Item


def _d(v: str) -> Decimal:
    try:
        return Decimal((v or "0").strip() or "0")
    except Exception:  # noqa: BLE001
        return Decimal(0)


def run(path: str, *, prefix: str, execute: bool) -> int:
    heads: dict[str, tuple[str, str, Decimal]] = {}
    lines: dict[str, list[tuple[str, str, Decimal]]] = defaultdict(list)
    for ln in open(path, encoding="utf-8"):
        p = [x.strip() for x in ln.rstrip("\n").split("~")]
        if len(p) >= 5 and p[0] == "H":
            heads[p[1]] = (p[2], p[3], _d(p[4]) or Decimal(1))
        elif len(p) >= 7 and p[0] == "L":
            div = _d(p[6]) or Decimal(1)
            lines[p[1]].append((p[2], p[3], _d(p[4]) + _d(p[5]) / div))
    if len(heads) < 10:
        print("⚠ ملف الوصفات فاضي أو ناقص — وقفت.")
        return 1

    db = SessionLocal()
    try:
        items = [i for i in db.scalars(select(Item)) if (i.code or "").startswith(prefix)]
        by_code = {i.code: i for i in items}
        by_name: dict[str, Item] = {}
        for i in items:
            by_name.setdefault(i.name, i)

        def find(code: str, name: str) -> Item | None:
            return by_code.get(f"{prefix}{code}") or by_name.get(name)

        changed = created = same = 0
        missing: list[str] = []
        plan = []
        for a5_id, (pcode, pname, out_qty) in heads.items():
            product = find(pcode, pname)
            if product is None:
                missing.append(f"منتج: {pname}")
                continue
            want: dict[int, Decimal] = defaultdict(Decimal)
            for rcode, rname, q in lines.get(a5_id, []):
                raw = find(rcode, rname)
                if raw is None:
                    missing.append(f"خامة: {rname} (لـ{pname})")
                    continue
                if q > 0:
                    want[raw.id] += q
            want = {k: to_qty(v) for k, v in want.items() if to_qty(v) > 0}
            if not want:
                continue
            bom = db.scalars(select(Bom).where(Bom.product_id == product.id, Bom.active.is_(True))
                             .order_by(Bom.id.desc())).first()
            if bom is None:
                plan.append(("new", product, None, want, out_qty))
                continue
            have: dict[int, Decimal] = defaultdict(Decimal)
            for c in bom.components:
                have[c.item_id] += to_qty(Decimal(str(c.quantity)) * Decimal(str(c.unit_factor or 1)))
            if dict(have) == want and to_qty(Decimal(str(bom.output_quantity))) == to_qty(out_qty):
                same += 1
                continue
            plan.append(("upd", product, bom, want, out_qty))

        names = {i.id: i.name for i in items}
        for kind, product, bom, want, _o in plan:
            if kind == "upd":
                old = {c.item_id: to_qty(Decimal(str(c.quantity)) * Decimal(str(c.unit_factor or 1)))
                       for c in bom.components}
                diff = [f"{names.get(k, k)}: {old.get(k, 0)}→{want.get(k, 0)}"
                        for k in sorted(set(old) | set(want)) if old.get(k) != want.get(k)]
                print(f"   اتعدّلت: {product.name} — {'، '.join(diff[:4])}")
            else:
                print(f"   جديدة: {product.name} ({len(want)} خامة)")
        print(f"\nوصفات a5 {len(heads)} · زي a5 {same} · هتتعدّل "
              f"{sum(1 for p in plan if p[0] == 'upd')} · هتتعمل {sum(1 for p in plan if p[0] == 'new')}")
        if missing:
            print(f"مش موجود عندنا ({len(missing)}): {'، '.join(missing[:8])}")
        if not execute:
            print("عرض فقط — `--yes` للتنفيذ.")
            return 0

        for kind, product, bom, want, out_qty in plan:
            if kind == "new":
                bom = Bom(product_id=product.id, name=f"وصفة {product.name}"[:160],
                          output_quantity=out_qty, active=True)
                db.add(bom)
                db.flush()
                created += 1
            else:
                for c in list(bom.components):
                    db.delete(c)
                bom.output_quantity = out_qty
                db.flush()
                changed += 1
            for item_id, q in want.items():
                db.add(BomComponent(bom_id=bom.id, item_id=item_id, quantity=q, unit_factor=1))
        db.commit()
        print(f"✔ اتعدّلت {changed} وصفة، واتعملت {created}.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    path = a[a.index("--file") + 1] if "--file" in a else ""
    prefix = a[a.index("--prefix") + 1] if "--prefix" in a else ""
    if not path or not prefix:
        print("لازم --file و--prefix.")
        sys.exit(2)
    sys.exit(run(path, prefix=prefix, execute="--yes" in a))
