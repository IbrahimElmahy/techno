"""يستورد حركة الكوبونات من نظام ما بعد البيع القديم: الصرف للموزع والاستلام من السباك.

    python -m src.scripts.import_erp_coupons --dir C:/pgtmp/erp --branch العلياء
    python -m src.scripts.import_erp_coupons --dir C:/pgtmp/erp --branch العلياء --yes

بيتعاد تشغيله بأمان: المستند اللي مرجعه موجود بيتخطى.

---------------------------------------------------------------------------
أربع قرارات:

* **الورقة بتخرج مرتين في حياتها.** بتتصرف لموزع (`TrandateDelivery`) وبترجع من سباك
  (`TransdateReceipt`). الاتنين مستندين مختلفين عندنا: «صرف كوبونات» و«استلام كوبونات»،
  مش صفين في جدول واحد. ١٩٦٤٩ اتصرفت و١٢٥٦٦ رجعت — الفرق ورق لسه برّه.

* **الفئة جوّه الرقم.** `NumCoupon` = «ذهبى-536000». بيتفصل لفئة ورقم، لأن هوية الكوبون
  عندنا (الفئة + الرقم) — و«٥ ذهبي» غير «٥ فضي».

* **المستند بيتجمّع بالموزع واليوم والفئة.** الصف عندهم ورقة واحدة؛ صرف ٥٠ ورقة لموزع
  في يوم = ٥٠ صف. تحويلهم لـ٥٠ مستند بيدّي سجل مالوش معنى — المستند الواحد بيلمّ
  اللي اتصرف لنفس الراجل في نفس اليوم من نفس الفئة.

* **اللي مالوش موزع مابيتصرفش.** ٤٣٠٤ ورقة `DistributorId` بتاعها صفر — دي أوراق
  اتسجّلت ومااتصرفتش لحد. بتتخطى بدل ما تتنسب لحد.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import date

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.customer import Customer
from src.models.org import Branch
from src.models.user import User
from src.scripts.import_a5 import _clean, _read

(C_SERIAL, C_DIST, C_PLUMB, C_DELIV, C_RECV, C_VALUE, C_REP, C_CODE_D, C_CODE_R, C_ID) = \
    range(10)


def _date(v: str) -> date | None:
    v = (v or "").strip()
    if len(v) != 8 or not v.isdigit():
        return None
    try:
        return date(int(v[:4]), int(v[4:6]), int(v[6:]))
    except ValueError:
        return None


def _split(num: str) -> tuple[str | None, str]:
    """«ذهبى-536000» → («ذهبى», «536000»). نظامهم كاتب الفئة جوّه الرقم."""
    num = _clean(num)
    if "-" in num:
        kind, _sep, serial = num.partition("-")
        kind, serial = kind.strip(), serial.strip()
        if kind and serial:
            return kind, serial
    return None, num


def run(folder: str, *, execute: bool, branch_name: str = "") -> None:
    rows = [r for r in _read(os.path.join(folder, "coupons.tsv")) if len(r) >= 10]

    issues: dict[tuple, list[list[str]]] = defaultdict(list)
    receipts: dict[tuple, list[list[str]]] = defaultdict(list)
    no_owner = 0
    for r in rows:
        kind, serial = _split(r[C_SERIAL])
        if not serial:
            continue
        out_on = _date(r[C_DELIV])
        if out_on and r[C_DIST] != "0":
            issues[(r[C_DIST], str(out_on), kind or "")].append(r)
        elif out_on:
            no_owner += 1
        back_on = _date(r[C_RECV])
        if back_on and r[C_PLUMB] != "0":
            receipts[(r[C_PLUMB], str(back_on), kind or "")].append(r)

    print("المصدر:")
    print(f"   أوراق                {len(rows):>7}")
    print(f"   مستندات صرف          {len(issues):>7}")
    print(f"   مستندات استلام       {len(receipts):>7}")
    print(f"   اتصرفت من غير موزع   {no_owner:>7}   (هتتخطى)")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    made: dict[str, int] = defaultdict(int)
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit("مافيش فرع اسمه " + branch_name)
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        admin = db.scalars(select(User).order_by(User.id)).first()
        print("الفرع المستهدف: " + branch.name + "\n")

        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        done_issue = {r for (r,) in db.execute(
            select(CouponIssue.external_ref).where(
                CouponIssue.external_ref.is_not(None))).all()}
        taken_receipt = {n for (n,) in db.execute(
            select(CouponReceipt.document_number)).all()}
        # الورقة بترجع مرة واحدة — القيد على (الفئة، الرقم) بيمنع التكرار، والفحص هنا
        # بيمنع الانفجار قبل ما يوصل للقاعدة.
        received = {(ln.coupon_kind, ln.serial) for ln in
                    db.scalars(select(CouponReceiptLine)).all()}
        issued = {(ln.coupon_kind, ln.serial) for ln in
                  db.scalars(select(CouponIssueLine)).all()}

        # ---------- الصرف ----------
        for (dist_id, day, kind), group in issues.items():
            ref = f"erp:issue:{dist_id}:{day}:{kind}"
            if ref in done_issue:
                continue
            owner = by_code.get(f"ERP-D-{dist_id}") or by_code.get(f"ERP-C-{dist_id}")
            fresh = [(kind or None, _split(g[C_SERIAL])[1]) for g in group]
            fresh = [(k, s) for k, s in fresh if (k, s) not in issued]
            if not fresh:
                continue
            value = next((g[C_VALUE] for g in group if g[C_VALUE] not in ("0", "")), None)
            issue = CouponIssue(
                document_number=f"CI-{dist_id}-{day.replace('-', '')}-{kind or 'X'}"[:24],
                branch_id=branch.id, customer_id=owner.id if owner else None,
                coupon_kind=kind or None, issue_date=_date(day.replace("-", "")),
                count=len(fresh), unit_value=value, external_ref=ref,
                actor_user_id=admin.id if admin else None)
            db.add(issue)
            db.flush()
            for k, s in fresh:
                db.add(CouponIssueLine(issue_id=issue.id, serial=s, coupon_kind=k))
                issued.add((k, s))
            done_issue.add(ref)
            made["مستندات صرف"] += 1
            made["أوراق اتصرفت"] += len(fresh)

        db.flush()
        issue_by_key = {(ln.coupon_kind, ln.serial): ln.issue_id
                        for ln in db.scalars(select(CouponIssueLine)).all()}

        # ---------- الاستلام ----------
        for (plumb_id, day, kind), group in receipts.items():
            number = f"CR-{plumb_id}-{day.replace('-', '')}-{kind or 'X'}"[:24]
            if number in taken_receipt:
                continue
            plumber = by_code.get(f"ERP-P-{plumb_id}") or by_code.get(f"ERP-C-{plumb_id}")
            fresh = [(kind or None, _split(g[C_SERIAL])[1]) for g in group]
            fresh = [(k, s) for k, s in fresh if (k, s) not in received]
            if not fresh:
                continue
            receipt = CouponReceipt(
                document_number=number, branch_id=branch.id,
                customer_id=plumber.id if plumber else None,
                received_date=_date(day.replace("-", "")),
                coupon_count=len(fresh), declared_kind=kind or None,
                actor_user_id=admin.id if admin else 1)
            db.add(receipt)
            db.flush()
            for k, s in fresh:
                db.add(CouponReceiptLine(
                    receipt_id=receipt.id, serial=s, coupon_kind=k,
                    coupon_issue_id=issue_by_key.get((k, s))))
                received.add((k, s))
            taken_receipt.add(number)
            made["مستندات استلام"] += 1
            made["أوراق رجعت"] += len(fresh)

        db.commit()
        print(f"{'الكيان':<22}{'عدد':>8}")
        print("-" * 30)
        for k, v in sorted(made.items()):
            print(f"{k:<22}{v:>8}")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/erp"
    target = args[args.index("--branch") + 1] if "--branch" in args else ""
    run(folder, execute="--yes" in args, branch_name=target)
