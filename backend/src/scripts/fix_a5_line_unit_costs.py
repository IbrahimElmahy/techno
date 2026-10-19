from __future__ import annotations

import argparse
import math
import os
import re
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import Date, cast, func, select, update

from src.core.db import SessionLocal
from src.core.money import to_money, to_qty
from src.models.catalog import Item
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.scripts.import_a5 import _money, _read, mine
from src.scripts.import_a5_docs import L_CODE, L_COST, L_NAME, L_ORD, L_ORDBK, L_QTY, L_TYPE
from src.services import costing_service
from src.services.a5_item_map import A5ItemMap

ZERO = Decimal(0)
A5_DOC = re.compile(r"^(AL-|FC-)?(S|SR)\d+$")
NEAR = math.log(1.6)
FAR = math.log(2.5)

KINDS = {
    "sale": (SalesInvoice, SalesInvoiceLine, "invoice_id", "S",
             lambda: func.coalesce(SalesInvoice.invoice_date, cast(SalesInvoice.created_at, Date))),
    "return": (SalesReturn, SalesReturnLine, "return_id", "SR",
               lambda: func.coalesce(SalesReturn.return_date, cast(SalesReturn.created_at, Date))),
}

LABELS = {
    "ok": "سليمة",
    "total_by_source": "إجمالي بدل الوحدة (بمصدر a5)",
    "total_by_reference": "إجمالي بدل الوحدة (بمقارنة التكلفة)",
    "filled": "كانت فاضية أو صفر واتملت",
    "ambiguous": "مش واضحة — بتتساب",
    "unknown": "فاضية ومالهاش مرجع — بتتساب",
    "outlier": "شاذة: لا وحدة ولا إجمالي (مع --outliers بتتسعّر بتكلفة الدفتر)",
}


def _source(db, specs: list[tuple[str, str]]) -> dict[tuple[str, int, Decimal], list[Decimal]]:
    out: dict[tuple[str, int, Decimal], list[Decimal]] = defaultdict(list)
    items = db.scalars(select(Item)).all()
    for prefix, folder in specs:
        a5map = A5ItemMap(db, prefix, mine(items, prefix))
        for r in _read(os.path.join(folder, "a5_lines.tsv")):
            if len(r) <= L_COST or r[L_TYPE] not in ("7", "2"):
                continue
            doc = f"{prefix}S{r[L_ORD]}" if r[L_TYPE] == "7" else f"{prefix}SR{r[L_ORDBK]}"
            it = a5map.find(r[L_CODE], r[L_NAME])
            qty = to_qty(_money(r[L_QTY]))
            if it is None or qty <= 0:
                continue
            out[(doc, it.id, qty)].append(_money(r[L_COST]))
    return out


def _dist(a: Decimal, b: Decimal) -> float:
    return abs(math.log(float(a) / float(b))) if a > 0 and b > 0 else math.inf


def classify(*, cost, qty: Decimal, factor: Decimal, price: Decimal, ref: Decimal | None,
             source: list[Decimal] | None, a5_doc: bool,
             reprice: bool = False) -> tuple[str, Decimal | None]:
    tol = Decimal("0.02")
    unit_ref = ref * factor if ref is not None and ref > 0 else None
    if cost is None or cost <= 0:
        t = next((t for t in source or [] if to_money(t / qty) > 0), None)
        if t is not None:
            return "filled", to_money(t / qty)
        if unit_ref is not None and to_money(unit_ref) > 0:
            return "filled", to_money(unit_ref)
        return "unknown", None
    if not a5_doc:
        return "ok", None
    per = cost / qty
    for t in source or []:
        if t <= 0:
            continue
        if abs(cost - t / qty) <= tol + abs(t / qty) * Decimal("0.001"):
            return "ok", None
        if qty != 1 and abs(cost - t) <= tol + abs(t) * Decimal("0.001"):
            return "total_by_source", to_money(t / qty)
    if unit_ref is not None:
        du, dt = _dist(cost, unit_ref), _dist(per, unit_ref)
        if du <= NEAR:
            return "ok", None
        if qty != 1 and dt <= NEAR and du >= FAR:
            return "total_by_reference", to_money(per)
        if du > FAR:
            return "outlier", to_money(unit_ref) if reprice else None
        return ("ok", None) if qty == 1 else ("ambiguous", None)
    if qty == 1:
        return "ok", None
    if price > 0:
        if cost <= price * 3:
            return "ok", None
        if per <= price * Decimal("1.2"):
            return "total_by_reference", to_money(per)
    return "ambiguous", None


def compute(db, *, specs: list[tuple[str, str]], reprice: bool) -> list[dict]:
    source = _source(db, specs)
    book = costing_service.cost_book(db)
    out = []
    for kind, (head, line, fk, _tag, day_of) in KINDS.items():
        day = day_of()
        after = 1 - func.coalesce(head.combined_pct, 0) / 100
        rows = db.execute(
            select(line.id, head.document_number, head.branch_id, day,
                   cast(head.created_at, Date), line.item_id, line.quantity,
                   line.unit_factor, line.unit_cost, line.line_total * after)
            .join(head, head.id == getattr(line, fk))).all()
        for lid, num, branch_id, d, made, item_id, q, f, u, net in rows:
            qty = Decimal(str(q or 0))
            if qty <= 0:
                continue
            factor = Decimal(str(f or 1))
            cost = Decimal(str(u)) if u is not None else None
            price = Decimal(str(net or 0)) / qty
            a5_doc = bool(A5_DOC.match(num or ""))
            src = source.get((num, item_id, to_qty(qty))) if a5_doc else None
            ref = book.at(item_id, d) if d else None
            verdict, new = classify(cost=cost, qty=qty, factor=factor, price=price,
                                    ref=ref, source=src, a5_doc=a5_doc, reprice=reprice)
            out.append({"kind": kind, "line_id": lid, "number": num, "branch_id": branch_id,
                        "day": d, "made": made, "item_id": item_id, "qty": qty,
                        "factor": factor, "cost": cost, "new": new, "verdict": verdict,
                        "ref": ref, "price": price})
    return out


def run(*, specs: list[tuple[str, str]], execute: bool, show: int, reprice: bool) -> None:
    db = SessionLocal()
    try:
        rows = compute(db, specs=specs, reprice=reprice)
        plan = [(r["kind"], r["line_id"], r["new"]) for r in rows if r["new"] is not None]
        stats: dict[tuple, list] = defaultdict(lambda: [0, ZERO, ZERO])
        ambiguous: list[str] = []
        for r in rows:
            qty, cost, new, verdict = r["qty"], r["cost"], r["new"], r["verdict"]
            key = (r["branch_id"], r["kind"], verdict, r["made"] if verdict != "ok" else None)
            old_value = qty * (cost or ZERO)
            s = stats[key]
            s[0] += 1
            s[1] += old_value
            s[2] += qty * new if new is not None else old_value
            if verdict in ("ambiguous", "outlier"):
                ref = r["ref"]
                ambiguous.append(
                    f"{r['number']:<14}{r['kind']:<7}صنف {r['item_id']:<7}كمية {qty:>10.3f}  "
                    f"تكلفة {cost!s:>12}  ÷كمية {to_money(per_of(cost, qty))!s:>10}  "
                    f"مرجع {to_money(ref * r['factor']) if ref else '—'!s:>10}  "
                    f"سعر {to_money(r['price'])!s:>10}  [{LABELS[verdict]}]")

        by_verdict: dict[tuple, list] = defaultdict(lambda: [0, ZERO, ZERO, None, None])
        by_sync: dict[tuple, list] = defaultdict(lambda: [0, ZERO, ZERO])
        totals: dict[tuple, list] = defaultdict(lambda: [ZERO, ZERO])
        for (branch_id, kind, verdict, made), (n, old, new) in stats.items():
            v = by_verdict[(branch_id, kind, verdict)]
            v[0] += n
            v[1] += old
            v[2] += new
            if made is not None:
                v[3] = made if v[3] is None else min(v[3], made)
                v[4] = made if v[4] is None else max(v[4], made)
            if new != old:
                w = by_sync[(branch_id, made)]
                w[0] += n
                w[1] += old
                w[2] += new
            totals[(branch_id, kind)][0] += old
            totals[(branch_id, kind)][1] += new
        print(f"{'فرع':>4} {'النوع':<7}{'الحكم':<36}{'سطور':>8}{'التكلفة قبل':>18}"
              f"{'التكلفة بعد':>18}  تواريخ النقل")
        print("-" * 118)
        for (branch_id, kind, verdict), (n, old, new, lo, hi) in sorted(
                by_verdict.items(), key=lambda kv: (kv[0][0] or 0, kv[0][1], kv[0][2])):
            span = f"{lo} → {hi}" if lo else ""
            print(f"{branch_id!s:>4} {kind:<7}{LABELS[verdict]:<36}{n:>8,}{to_money(old):>18,}"
                  f"{to_money(new):>18,}  {span}")
        print("\nالسطور اللي هتتغير حسب يوم نقلها:")
        for (branch_id, made), (n, old, new) in sorted(by_sync.items(),
                                                        key=lambda kv: (kv[0][0] or 0, kv[0][1])):
            print(f"   فرع {branch_id}  {made}  {n:>6,} سطر  "
                  f"{to_money(old):>16,} ← {to_money(new):>14,}")
        print("\nإجمالي التكلفة المجمّدة لكل فرع:")
        for (branch_id, kind), (old, new) in sorted(totals.items(),
                                                    key=lambda kv: (kv[0][0] or 0, kv[0][1])):
            print(f"   فرع {branch_id} {kind:<7} قبل {to_money(old):>18,}"
                  f"   بعد {to_money(new):>18,}"
                  f"   الفرق {to_money(new - old):>16,}")
        print(f"\nسطور هتتصلّح: {len(plan):,} · سطور متسابة للمراجعة: {len(ambiguous):,}")
        for a in ambiguous[:show]:
            print("   " + a)
        if len(ambiguous) > show:
            print(f"   … و{len(ambiguous) - show:,} غيرهم (زوّد --show)")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return
        for kind, lid, new in plan:
            line = KINDS[kind][1]
            db.execute(update(line).where(line.id == lid).values(unit_cost=new))
        db.commit()
        print(f"\nتم: {len(plan):,} سطر.")
    finally:
        db.close()


def per_of(cost, qty) -> Decimal:
    return (cost or ZERO) / qty if qty else ZERO


def main() -> None:
    ap = argparse.ArgumentParser(description="تصحيح تكلفة الوحدة المجمّدة على سطور البيع والمرتجع")
    ap.add_argument("--src", action="append", default=[],
                    help="PREFIX=DIR لملف a5_lines.tsv (يتكرر لكل فرع؛ أكتوبر بادئته فاضية)")
    ap.add_argument("--show", type=int, default=400)
    ap.add_argument("--outliers", action="store_true",
                    help="سعّر السطور الشاذة بتكلفة الدفتر في تاريخ المستند")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    specs = [tuple(s.split("=", 1)) for s in a.src]
    run(specs=specs, execute=a.yes, show=a.show, reprice=a.outliers)


if __name__ == "__main__":
    main()
