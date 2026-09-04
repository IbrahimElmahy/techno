"""يصلّح `unit_cost` اللي متخزّن فيه إجمالي السطر بدل سعر الوحدة — بمطابقة المصدر.

    python -m src.scripts.fix_unit_costs --aliaa-dir C:/pgtmp/aliaa --oct-dir C:/pgtmp          # يعرض بس
    python -m src.scripts.fix_unit_costs --aliaa-dir C:/pgtmp/aliaa --oct-dir C:/pgtmp --yes    # ينفّذ

**اللي اتقاس (سطور البيع على السيرفر مقابل تصدير a5 نفسه):**

* عمود `a_AvPrice` عند a5 **إجمالي تكلفة السطر** مش سعر الوحدة: في ٩٦٪ من السطور
  هو أقل من إجمالي البيع (تكلفة حقيقية)، وفي ٦٩ سطر صدى للإجمالي بالحرف. والمستورد
  حطه في `unit_cost` زي ما هو — فـ٤١ ألف سطر شايلين التكلفة الإجمالية في خانة الوحدة.
* `unit_price` شكله غلط لكنه سليم: الفرق `price×qty − total` هو خصم الفاتورة
  (البونص) على الترويسة. فالإصلاح تكلفة بس، والسعر مابيتلمسش.
* السطور اللي اتعدّلت بعد النقل من الشاشة (تكلفتها محسوبة من المتوسط) بتتكشف
  لوحدها: تكلفتها الحالية مختلفة عن `a_AvPrice` بتاع المصدر — ودي مابتتلمسش.

**القاعدة:** سطر مستورد كميته مش ١ وتكلفته الحالية بتطابق `a_AvPrice` بتاع نفس
السطر في المصدر ← التكلفة الجديدة = `AvPrice ÷ الكمية` (مقرّبة لقرشين).
الحارس: الجديد × الكمية بيطابق `AvPrice` الأصلي — واللي مايطابقش بيتقال
ومايتغيّرش. سطور الكمية ١ صح أصلاً، والمجهولة التكلفة (`AvPrice = 0`) بتفضل فاضية.

**الأثر:** تقارير الربحية بتحسب `cost = unit_cost × qty` (`lib/trade_reports`) —
التضاعف كان بيضرب التكلفة في الكمية مرة زيادة. اللي بيفضل بعد الإصلاح هامش
التكلفة الحقيقية من المصدر نفسه، مش صفري بالعافية.

**الحرّاس:** عرض افتراضي و`--yes` للتنفيذ، وبيتعاد تشغيله بأمان (التانية بتلاقي
صفر — التكلفة المتصلّحة مابتطابقش `AvPrice` فمابتترشّحش).
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.catalog import Item
from src.models.sales import SalesInvoice, SalesInvoiceLine, SalesReturn, SalesReturnLine
from src.scripts.import_a5 import _clean, _money, _read
from src.core.money import to_qty

ZERO = Decimal("0")
CENT = Decimal("0.01")


def _same(cost: Decimal, av: Decimal) -> bool:
    """التكلفة الحالية هي نفس `AvPrice` بتاع المصدر؟

    التفاوت المطلق لوحده مايكفيش: `AvPrice` متوسط متحرك عند a5 وبيتحرك مع كل
    شرا جديد، فالقيمة النهاردة مش بالحرف زي يوم النقل (متقاس: انحراف ≤ ٠٫٠٢٪
    على ٣٩ سطر). والتعديل الحقيقي من الشاشة بيحسب تكلفة وحدة (≈ المتوسط ÷
    الكمية) فبيبعد بعامل الكمية — فجوة واسعة بين الغبار والحقيقة، والعتبة
    النسبية ٠٫٢٪ قاعدة في نصها بالأمان.
    """
    return abs(cost - av) <= max(Decimal("0.05"), abs(av) * Decimal("0.002"))

# نوع a5: بيع (المفتاح Ord) ومردود بيع (المفتاح OrdBk)
(L_TYPE, L_AZN, _L_DATE, L_ORD, L_ORDBK, _L_POORD, _L_POBK, L_CODE, L_NAME,
 _L_IN, _L_OUT, L_QTY, _L_PRICE, L_TOTAL, _L_MEMO, _L_JUST, L_COST) = range(17)


def _src_rows(path: str, doctype: str) -> dict[str, list]:
    """المفتاح الداخلي (Ord/OrdBk) ← [(الكود، الاسم، الكمية، AvPrice)] لصفوف النوع."""
    out: dict[str, list] = defaultdict(list)
    if not os.path.exists(path):
        return out
    for r in _read(path):
        if len(r) < 17 or r[L_TYPE] != doctype:
            continue
        key = r[L_ORD] if doctype == "7" else r[L_ORDBK]
        out[key].append((_clean(r[L_CODE]), _clean(r[L_NAME]),
                         to_qty(_money(r[L_QTY])), _money(r[L_COST])))
    return out


(H_KIND, H_ID, H_NO, _H_DATE, _H_PARTY, _H_REP, _H_GROSS, _H_BONS, _H_TAX,
 _H_NET, _H_CASH, _H_CREDIT, _H_PTYPE, _H_MEMO, _H_USER) = range(15)


def _hdr_map(path: str, table: str) -> tuple[dict[str, str], list[str]]:
    """الرقم المطبوع (H_NO) ← المفتاح الداخلي (H_ID). المكرر بيتقال وبيتخطى."""
    ids: dict[str, list] = defaultdict(list)
    if not os.path.exists(path):
        return {}, [f"مافيش ملف: {path}"]
    for r in _read(path):
        if len(r) < 15 or r[H_KIND] != table:
            continue
        ids[r[H_NO]].append(r[H_ID])
    dupes = [f"{table} NO={no} ({len(v)} رؤوس)" for no, v in ids.items() if len(v) > 1]
    return {no: v[0] for no, v in ids.items() if len(v) == 1}, dupes


def run(*, aliaa_dir: str, oct_dir: str, execute: bool) -> None:
    # رقمنا الخارجي = الرقم المطبوع (H_NO) مش الداخلي (Ord) — فالوصلة عبر الرؤوس:
    # (الفرع، المطبوع) ← سطور المصدر. والمطبوع المكرر عندهم بيقع (بيتقال).
    sale_src: dict[tuple[str, str], list] = {}
    ret_src: dict[tuple[str, str], list] = {}
    hdr_dupes: list[str] = []
    for prefix, folder in (("AL-", aliaa_dir), ("", oct_dir)):
        sale_rows = _src_rows(os.path.join(folder, "a5_lines.tsv"), "7")
        ret_rows = _src_rows(os.path.join(folder, "a5_lines.tsv"), "2")
        sale_no, dupes = _hdr_map(os.path.join(folder, "a5_hdr.tsv"), "SALE")
        ret_no, dupes2 = _hdr_map(os.path.join(folder, "a5_hdr.tsv"), "SRET")
        hdr_dupes += dupes + dupes2
        for printed, internal in sale_no.items():
            if internal in sale_rows:
                sale_src[(prefix, printed)] = sale_rows[internal]
        for printed, internal in ret_no.items():
            if internal in ret_rows:
                ret_src[(prefix, printed)] = ret_rows[internal]

    db = SessionLocal()
    try:
        items = db.scalars(select(Item)).all()
        by_code = {i.code: i for i in items if i.code}
        by_name = {i.name: i for i in items if i.name}

        def resolve(prefix, code, name):
            return by_code.get(f"{prefix}{code}") or by_name.get(name)

        plan: list[tuple] = []
        edited: list[str] = []
        unguarded: list[str] = []
        no_source = 0
        av_zero = 0
        inflated = ZERO  # مجموع التكلفة المتضخمة حالياً على سطور الخطة
        trued = ZERO     # مجموعها بعد الإصلاح

        # --- البيع ---
        for inv in db.scalars(select(SalesInvoice)).all():
            prefix = "AL-" if inv.document_number.startswith("AL-") else ""
            if not inv.external_document_number:
                continue
            src = sale_src.get((prefix, str(inv.external_document_number)))
            if src is None:
                continue
            pool: dict[tuple, list] = defaultdict(list)
            for ln in inv.lines:
                pool[(ln.item_id, Decimal(ln.quantity))].append(ln)
            for code, name, qty, av in src:
                if qty <= 0:
                    continue
                it = resolve(prefix, code, name)
                if it is None:
                    continue
                cands = pool.get((it.id, qty), [])
                if not cands:
                    no_source += 1
                    continue
                ln = cands.pop(0)
                if ln.unit_cost is None:
                    if av == 0:
                        av_zero += 1
                    else:
                        edited.append(f"{inv.document_number} «{name}» cost=NULL وAvPrice={av}")
                    continue
                cost = Decimal(ln.unit_cost)
                if not _same(cost, av):
                    edited.append(f"{inv.document_number} «{name}» cost={cost} ≠ AvPrice={av}")
                    continue
                if qty == 1 or av == 0:
                    continue
                new = (av / qty).quantize(CENT, rounding=ROUND_HALF_UP)
                if abs(new * qty - av) > CENT * qty + Decimal("0.05"):
                    unguarded.append(f"{inv.document_number} «{name}»")
                    continue
                plan.append((ln, cost, new))
                inflated += cost * qty
                trued += av

        # --- مردود البيع ---
        for ret in db.scalars(select(SalesReturn)).all():
            prefix = "AL-" if ret.document_number.startswith("AL-") else ""
            if not ret.external_document_number:
                continue
            src = ret_src.get((prefix, str(ret.external_document_number)))
            if src is None:
                continue
            pool = defaultdict(list)
            for ln in ret.lines:
                pool[(ln.item_id, Decimal(ln.quantity))].append(ln)
            for code, name, qty, av in src:
                if qty <= 0:
                    continue
                it = resolve(prefix, code, name)
                if it is None:
                    continue
                cands = pool.get((it.id, qty), [])
                if not cands:
                    no_source += 1
                    continue
                ln = cands.pop(0)
                if ln.unit_cost is None:
                    if av == 0:
                        av_zero += 1
                    continue
                cost = Decimal(ln.unit_cost)
                if not _same(cost, av):
                    edited.append(f"{ret.document_number} «{name}» cost={cost} ≠ AvPrice={av}")
                    continue
                if qty == 1 or av == 0:
                    continue
                new = (av / qty).quantize(CENT, rounding=ROUND_HALF_UP)
                if abs(new * qty - av) > CENT * qty + Decimal("0.05"):
                    unguarded.append(f"{ret.document_number} «{name}»")
                    continue
                plan.append((ln, cost, new))
                inflated += cost * qty
                trued += av

        print(f"سطور هتتصلّح: {len(plan)}")
        print(f"   التكلفة المتضخمة حالياً: {inflated:,.2f}")
        print(f"   التكلفة الحقيقية بعد:    {trued:,.2f}")
        print(f"   الفرق (التضخم اللي هيتشال): {inflated - trued:,.2f} ج")
        print(f"سطور اتعدّلت بعد النقل (مش هتتلمس): {len(edited)}")
        for e in edited[:8]:
            print(f"   {e}")
        if len(edited) > 8:
            print(f"   ... و{len(edited) - 8} غيرهم")
        print(f"صفوف مصدر مالوش سطر عندنا: {no_source} · تكلفة مجهولة: {av_zero}")
        if hdr_dupes:
            print(f"\n⚠️ {len(hdr_dupes)} رقم مطبوع مكرر عند a5 — مستنداته مش هتتلمس:")
            for d in hdr_dupes[:10]:
                print(f"   {d}")
        if unguarded:
            print(f"\n⚠️ {len(unguarded)} سطر كاسر الحارس — مش هيتغيّر:")
            for u in unguarded[:10]:
                print(f"   {u}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        done = 0
        for ln, _cost, new in plan:
            ln.unit_cost = new
            done += 1
            if done % 5000 == 0:
                db.flush()
        db.commit()
        print(f"\n✔ اتصلّح {done} سطر.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    aliaa = args[args.index("--aliaa-dir") + 1] if "--aliaa-dir" in args else "C:/pgtmp/aliaa"
    octd = args[args.index("--oct-dir") + 1] if "--oct-dir" in args else "C:/pgtmp"
    run(aliaa_dir=aliaa, oct_dir=octd, execute="--yes" in args)
