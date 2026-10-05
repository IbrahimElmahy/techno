"""إجماليات رؤوس مستندات السادات اللي اتنقلت بصفر — بتتملا من a5 (٢٠٢٦-١٠-٠٥).

    python -m src.scripts.fix_sadat_doc_totals --file /opt/techno/a5factory/a5_doc_totals.txt
    python -m src.scripts.fix_sadat_doc_totals --file ... --yes

**اللي اتكشف:** في السادات ٧٤٧ فاتورة بيع و٧٧ مرتجع بيع و٢٣ مرتجع شرا رأسهم صفر (الإجمالي
والصافي)، والسطور والقيود سليمة. تقرير المبيعات بيقرا `net`، فمبيعات السادات كانت طالعة
٢٫٧ مليون بدل ~٢٨.

**السبب:** قاعدة المصنع بتسيب `Emali_Bfr` (الإجمالي قبل الخصم) صفر في `Ord` و`OrdBK`
و`PoordBK` كلهم — والاستيراد بياخد الإجمالي منه. الإجمالي الحقيقي في `emali_aftax`،
والصافي في `Emali_aftr`، والخصم في `Bons`. في الشرا (`PoOrd`) `Emali_Bfr` متملي، فهو سليم.

**الملف** تصدير `SELECT` بس من قاعدة a5 (`factory Pro2026`) — سطر لكل مستند:
`نوع~رقم~Emali_Bfr~Bons~Emali_aftr~emali_aftax~totalstax~Mny_pay~Baki`، والنوع
S / SR / P / PR (نفس حرف رقم المستند عندنا: `FC-S<Ord_id>`).

**بيتملا بنفس شكل العلياء:** `gross` = الإجمالي، `net`/`value` = الصافي، ونسبة الخصم
`variable_discount_pct = combined_pct` = الخصم ÷ الإجمالي. الكاش والآجل والسطور والقيود
مابيتلمسوش.

مقفول على السادات (`branch_id` الفرع + بادئة `FC-`)، وعلى الرؤوس اللي إجماليها صفر بس.
"""
from __future__ import annotations

import argparse
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import text

from src.core.db import SessionLocal

BRANCH = "السادات"
PREFIX = "FC-"
C2 = Decimal("0.01")


def _d(x: str) -> Decimal:
    try:
        return Decimal((x or "0").strip() or "0")
    except Exception:  # noqa: BLE001
        return Decimal(0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()

    a5: dict[str, tuple[Decimal, Decimal, Decimal]] = {}
    for ln in open(a.file, encoding="utf-8"):
        p = ln.rstrip("\n").split("~")
        if len(p) < 6 or p[0] not in ("S", "SR", "PR"):
            continue
        bons, after, before = _d(p[3]), _d(p[4]), _d(p[5])
        gross = _d(p[2]) if _d(p[2]) != 0 else before
        a5[f"{PREFIX}{p[0]}{p[1].strip()}"] = (gross, after, bons)

    db = SessionLocal()
    try:
        bid = db.execute(text("select id from branch where name=:n"), {"n": BRANCH}).scalar_one()
        targets = {
            "sales_invoice": "select id, document_number from sales_invoice where branch_id=:b and gross=0",
            "sales_return": "select id, document_number from sales_return where branch_id=:b and gross=0",
            "purchase_return": "select id, document_number from purchase_return where branch_id=:b and gross=0",
        }
        plan: list[tuple[str, int, str, Decimal, Decimal, Decimal]] = []
        missing: list[str] = []
        for table, sql in targets.items():
            for rid, num in db.execute(text(sql), {"b": bid}).all():
                if not num.startswith(PREFIX) or num not in a5:
                    missing.append(num)
                    continue
                gross, net, bons = a5[num]
                if gross == 0 and net == 0:
                    continue
                pct = (bons / gross * 100).quantize(C2, ROUND_HALF_UP) if gross else Decimal(0)
                plan.append((table, rid, num, gross.quantize(C2, ROUND_HALF_UP),
                             net.quantize(C2, ROUND_HALF_UP), pct))

        by_t: dict[str, list] = {}
        for row in plan:
            by_t.setdefault(row[0], []).append(row)
        for t, rows in by_t.items():
            print(f"{t:<16}{len(rows):>5} رأس  · إجمالي {sum(r[3] for r in rows):>16,.2f}"
                  f"  · صافي {sum(r[4] for r in rows):>16,.2f}")
        if missing:
            print(f"\nمالهاش رأس في ملف a5 ({len(missing)}): {', '.join(missing[:20])}")
        for r in plan[:5]:
            print("   مثال:", r[2], "إجمالي", r[3], "صافي", r[4], "خصم %", r[5])

        if not a.yes:
            print("\nعرض فقط — `--yes` للتنفيذ.")
            return
        for table, rid, _num, gross, net, pct in plan:
            if table == "sales_invoice":
                db.execute(text("""update sales_invoice set gross=:g, net=:n, variable_discount_pct=:p,
                    combined_pct=:p where id=:i and branch_id=:b and gross=0"""),
                    {"g": gross, "n": net, "p": pct, "i": rid, "b": bid})
            else:
                db.execute(text(f"""update {table} set gross=:g, value=:n, combined_pct=:p
                    where id=:i and branch_id=:b and gross=0"""),
                    {"g": gross, "n": net, "p": pct, "i": rid, "b": bid})
        db.commit()
        print(f"\n✔ اتملا {len(plan)} رأس مستند — في {BRANCH} بس.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
