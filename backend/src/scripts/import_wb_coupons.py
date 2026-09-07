"""ينقل حركة الكوبونات من ملف العميل: الصرف للتاجر والاستلام من الفني.

    python -m src.scripts.import_wb_coupons --dir C:/pgtmp/wb2          # يعرض بس
    python -m src.scripts.import_wb_coupons --dir C:/pgtmp/wb2 --yes    # ينفّذ

بيتعاد تشغيله بأمان: المستند اللي مرجعه (`external_ref`) موجود بيتخطى، والورقة
اللي اتسجّلت في مستند بتتخطى.

---------------------------------------------------------------------------
⛔ **قاعدة `ERP` ممنوع لمسها** (شوف `CLAUDE.md`). المصدر صفحة «كوبونات» في ملف
العميل، مصدَّرة TSV — وفيها الجسر لـa5 جوّه الحركة نفسها («كود تاجر» =
`AL-A5-424`)، فمافيش ملف أطراف منفصل ولا مطابقة أسماء.

---------------------------------------------------------------------------
القرارات (متوارثة من التحليل اللي اتعمل على القاعدة الحيّة قبل ما تتقفل):

* **الورقة بتخرج مرتين في حياتها.** بتتصرف لتاجر (تاريخ تسلم) وبترجع من فني
  (تاريخ استلام). الاتنين مستندين مختلفين عندنا: «صرف كوبونات» و«استلام كوبونات».

* **مستند الاستلام موجود في الملف بالاسم: `CodeReceipt`.** كل رقم عليه فني واحد
  وتاريخ واحد ومندوب واحد. فالتجميع عليه هو — التجميع بالإيد (فني + يوم) بيلحّم
  مستندين ويشرشر واحد.

* **مستند الصرف مالوش رقم يتمسك بيه.** `CodeDelivery` بيتكرر، فبيتبنى من
  (تاجر + يوم + فئة + مندوب التسليم). المندوب داخل في المفتاح لأن من غيره
  المجموعة بتخلط مندوبين والمستند بيكدب على واحد فيهم.

* **الفئة جوّه رقم الكوبون.** «ذهبى-536000» → فئة ورقم. الهوية عندنا (الفئة +
  الرقم) — و«٥ ذهبي» غير «٥ فضي». والفئة بتتطوى (ى→ي) عشان تقع على قايمة
  `coupon_kind`. **الطي على الفئة بس** — دي تسمية صنف؛ أسماء الناس مابتتطويش
  والهمزة مابتتلمسش (a5 بيفرّق بيها بين ناس).

* **التاجر بالكود مستحيل بالاسم.** الملف بيقول «تكنو محمد الجزار» وكارتنا بيقول
  «محمد الجزار» — نفس الراجل باسمين. `AL-A5-424` هو اللي بيوصّل، واتأكد إن
  ١٩٬٦١٤ صف كودهم ليه كارت عندنا و٢١ على كارت مدموج (بيروحوا للكارت الباقي).

* **الفني في الغالب مالوش كارت.** اللي مالوش بيتكتب اسمه في `notes` والمستند
  بيفضل بغير عميل — اختراع كارت ليه بيدخّل في كشف العملاء ناس صاحب الشغل
  مادخّلهمش.

* **`valuecoupon` قيمة الاستلام مش الصرف.** فاضية على اللي مارجعش ومتحطوطة على
  اللي رجع (١٣٥/١٦٥ للذهبي، ٤٥/٥٥ للفضي) — دي اللي اتدفعت للفني ساعة ما سلّم،
  فمكانها `declared_value` على الاستلام.

* **الإقرار بيتكتب لما الدفعة تتفق.** المستند اللي فيه أكتر من فئة أو أكتر من
  قيمة مالوش إقرار واحد — `declared_kind`/`declared_value` بيفضلوا فاضيين
  والسطر هو اللي شايل الفئة.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.customer import Customer
from src.models.org import Branch
from src.models.user import User
from src.scripts.import_wb_traders import ALIAS

BRANCH = "العلياء"
ISSUE_PREFIX = "WBI-"
TRADER_PREFIX = "WB-T-"    # تجار صفحة «اضافه تجار» — مش في a5
RECEIPT_PREFIX = "WBR-"

# رقم اليوزر القديم في الملف → حساب الدخول، عبر كود الموظف.
EMP_TO_USER = {
    "EMP-0053": "ashraf", "EMP-0002": "ibrahim.khattab", "EMP-0003": "anas",
    "EMP-0008": "bayoumy", "EMP-0004": "hassan.eid", "EMP-0005": "ahmed.torky",
    "EMP-0054": "care", "EMP-0006": "mohamed.mamdouh", "EMP-0007": "medhat",
    "EMP-0055": "mohamed.torky", "EMP-0040": "sales.dept2",
    "EMP-0045": "car.a", "EMP-0043": "car.b", "EMP-0046": "car.g",
    "EMP-0044": "car.d", "EMP-0047": "car.sharqia",
}


def _read(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        raise SystemExit(f"مافيش {path} — صدّر صفحات الملف الأول.")
    with open(path, encoding="utf-8", newline="") as fh:
        return [{k: (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(fh, delimiter="\t")]


def _date(v: str) -> date | None:
    v = (v or "").strip()
    if not v or v in ("0", "NULL"):
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d"):
        try:
            return datetime.strptime(v[:10] if "-" in v else v[:8], fmt).date()
        except ValueError:
            continue
    return None


def _money(v: str) -> Decimal | None:
    v = (v or "").strip()
    if not v or v == "NULL":
        return None
    try:
        return Decimal(v)
    except (InvalidOperation, ValueError):
        return None


def _kind(serial: str) -> str | None:
    """فئة الكوبون من رقمه: «ذهبى-536000» → «ذهبي». الطي على الفئة بس."""
    head = (serial or "").split("-", 1)[0].strip()
    return head.replace("ى", "ي") if head else None


def run(folder: str, *, execute: bool) -> None:
    rows = _read(os.path.join(folder, "coupons.tsv"))
    reps = _read(os.path.join(folder, "reps.tsv"))
    emp_by_uid = {r["user_id"]: r["emp_code"] for r in reps if r.get("user_id")}
    emp_by_code = {r["emp_code"]: r["emp_code"] for r in reps if r.get("emp_code")}

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == BRANCH))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{BRANCH}».")
        users = {u.username: u for u in db.scalars(select(User)).all()}
        admin = db.scalar(select(User).order_by(User.id))
        if admin is None:
            # `actor_user_id` إجباري على المستندين — اللي سجّل الحركة.
            raise SystemExit("مافيش ولا يوزر في النظام — مين اللي سجّل؟")
        custs = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        # الكارت المدموج بيوصّل للكارت الباقي — رقمه في آخر اسمه «(مدموج في #123)».
        by_id = {c.id: c for c in custs.values()}

        def resolve(code: str) -> Customer | None:
            # الكود اللي في الملف نوعين: كود a5 صريح (`AL-A5-424`) ورقم داخلي
            # لتاجر العميل ضافه في نظام ما بعد البيع بس (`1001741`). التاني كارته
            # عندنا بكود `WB-T-{id}` — شوف `import_wb_traders`. الـ٨٨ صف اللي كانت
            # بتتخطّى كانت كلها من النوع التاني.
            c = (custs.get(code) or custs.get(TRADER_PREFIX + code)
                 or custs.get(ALIAS.get(code, "")))
            if c is None or c.active:
                return c
            mark = "(مدموج في #"
            if mark in (c.name or ""):
                try:
                    keep = int(c.name.split(mark, 1)[1].split(")", 1)[0])
                    return by_id.get(keep) or c
                except ValueError:
                    return c
            return c

        def rep_of(val: str, emp: str) -> User | None:
            code = emp_by_code.get(emp) or emp_by_uid.get(val)
            return users.get(EMP_TO_USER.get(code, "")) if code else None

        taken_i = {r for (r,) in db.execute(
            select(CouponIssue.external_ref)).all() if r}
        taken_r = {n for (n,) in db.execute(
            select(CouponReceipt.document_number)).all()}

        issues: dict[tuple, list[dict[str, str]]] = defaultdict(list)
        receipts: dict[str, list[dict[str, str]]] = defaultdict(list)
        notes: Counter = Counter()

        for r in rows:
            serial = r.get("serial", "")
            kind = _kind(serial)
            if not serial:
                notes["صف بلا رقم كوبون"] += 1
                continue
            code = r.get("trader_a5", "")
            trader = resolve(code) if code else None
            if code and trader is None:
                notes["كود تاجر مش عندنا"] += 1
            d_dt = _date(r.get("deliv_date", ""))
            d_rep = rep_of(r.get("rep_deliv_emp", ""), r.get("rep_deliv_emp", ""))
            if trader is not None and d_dt is not None:
                issues[(trader.id, d_dt, kind, d_rep.id if d_rep else 0)].append(r)
            else:
                notes["مافيش صرف (بلا تاجر أو تاريخ)"] += 1

            rcode = r.get("code_receipt", "")
            r_dt = _date(r.get("recv_date", ""))
            if rcode and rcode != "0" and r_dt is not None:
                receipts[rcode].append(r)

        print(f"صفوف الملف: {len(rows)}")
        for k, c in notes.most_common(8):
            print(f"   {k:<38}{c:>7}")
        new_i = {k: v for k, v in issues.items()
                 if f"wb:{k[0]}:{k[1]}:{k[2]}:{k[3]}" not in taken_i}
        new_r = {k: v for k, v in receipts.items()
                 if RECEIPT_PREFIX + k not in taken_r}
        print(f"\n   {'مستندات صرف':<38}{len(issues):>7}   جديد {len(new_i)}")
        print(f"   {'أوراق فيها':<38}{sum(len(v) for v in new_i.values()):>7}")
        print(f"   {'مستندات استلام':<38}{len(receipts):>7}   جديد {len(new_r)}")
        print(f"   {'أوراق فيها':<38}{sum(len(v) for v in new_r.values()):>7}")
        mixed_k = sum(1 for v in new_r.values() if len({_kind(x['serial']) for x in v}) > 1)
        mixed_v = sum(1 for v in new_r.values()
                      if len({x.get('value') for x in v if x.get('value')}) > 1)
        print(f"   {'استلام بأكتر من فئة (بلا إقرار)':<38}{mixed_k:>7}")
        print(f"   {'استلام بأكتر من قيمة (بلا إقرار)':<38}{mixed_v:>7}")
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        n_i = n_il = n_r = n_rl = 0
        # الترقيم بيكمّل من آخر مستند موجود مش بيبدأ من واحد — `document_number`
        # فريد، فتشغيلة تانية بتعمل مستندات جديدة بأرقام مصطدمة بالقديمة.
        seq = db.scalar(select(func.count()).select_from(CouponIssue)) or 0
        for (cid, d_dt, kind, rid), lines in new_i.items():
            ref = f"wb:{cid}:{d_dt}:{kind}:{rid}"
            doc = CouponIssue(
                document_number=f"{ISSUE_PREFIX}{seq + n_i + 1:06d}", branch_id=branch.id,
                customer_id=cid, coupon_kind=kind, issue_date=d_dt,
                count=len(lines), rep_user_id=rid or None,
                external_ref=ref, actor_user_id=admin.id, active=True)
            db.add(doc)
            db.flush()
            n_i += 1
            for x in lines:
                db.add(CouponIssueLine(issue_id=doc.id, serial=x["serial"][:24],
                                       coupon_kind=kind))
                n_il += 1

        for rcode, lines in new_r.items():
            kinds = {_kind(x["serial"]) for x in lines}
            vals = {x.get("value") for x in lines if x.get("value")}
            first = lines[0]
            rep = rep_of(first.get("rep_recv_emp", ""), first.get("rep_recv_emp", ""))
            tech = first.get("plumber_name") or ""
            doc = CouponReceipt(
                document_number=RECEIPT_PREFIX + rcode[:18], branch_id=branch.id,
                customer_id=None, rep_user_id=rep.id if rep else None,
                received_date=_date(first.get("recv_date", "")),
                coupon_count=len(lines),
                notes=(f"الفني: {tech}" if tech else None),
                declared_kind=(next(iter(kinds)) if len(kinds) == 1 else None),
                declared_value=(_money(next(iter(vals))) if len(vals) == 1 else None),
                actor_user_id=admin.id)
            db.add(doc)
            db.flush()
            n_r += 1
            for x in lines:
                db.add(CouponReceiptLine(receipt_id=doc.id, serial=x["serial"][:24]))
                n_rl += 1
        db.commit()

        print(f"\n✔ صرف: {n_i} مستند / {n_il} ورقة   ·   استلام: {n_r} مستند / {n_rl} ورقة")
        ti = db.scalar(select(func.count()).select_from(CouponIssue)) or 0
        tr = db.scalar(select(func.count()).select_from(CouponReceipt)) or 0
        til = db.scalar(select(func.count()).select_from(CouponIssueLine)) or 0
        trl = db.scalar(select(func.count()).select_from(CouponReceiptLine)) or 0
        print(f"   الإجمالي: صرف {ti}/{til} · استلام {tr}/{trl}")
    finally:
        db.close()


def main() -> None:
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/wb2"
    run(folder, execute="--yes" in args)


if __name__ == "__main__":
    main()
