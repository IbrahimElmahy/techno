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
from src.scripts.wb_profile import ALIAA, WbProfile, dir_from_argv, profile_from_argv
from src.services import coupon_receipt_service


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
    head = (serial or "").split("-", 1)[0].strip()
    return head.replace("ى", "ي") if head else None


def run(folder: str, *, execute: bool, profile: WbProfile = ALIAA) -> None:
    rows = _read(os.path.join(folder, "coupons.tsv"))
    kinds_known = {_kind(k) for k in profile.coupon_kind_by_prefix.values()}

    def value_of(x: dict[str, str]) -> str:
        v = x.get("value") or ""
        return "" if profile.zero_value_unknown and _money(v) == 0 else v
    reps = _read(os.path.join(folder, "reps.tsv"))
    emp_by_uid = {r["user_id"]: r["emp_code"] for r in reps if r.get("user_id")}
    emp_by_code = {r["emp_code"]: r["emp_code"] for r in reps if r.get("emp_code")}

    db = SessionLocal()
    try:
        branch = db.scalar(select(Branch).where(Branch.name == profile.branch))
        if branch is None:
            raise SystemExit(f"مافيش فرع اسمه «{profile.branch}».")
        users = {u.username: u for u in db.scalars(select(User)).all()}
        admin = db.scalar(select(User).order_by(User.id))
        if admin is None:
            raise SystemExit("مافيش ولا يوزر في النظام — مين اللي سجّل؟")
        custs = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        by_id = {c.id: c for c in custs.values()}

        def resolve(code: str) -> Customer | None:
            return follow(custs.get(code) or custs.get(profile.trader_prefix + code)
                          or custs.get(profile.trader_alias.get(code, "")))

        def follow(c: Customer | None) -> Customer | None:
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

        def receiver_of(x: dict[str, str]) -> Customer | None:
            pcode = (x.get("plumber_code") or "").strip()
            if pcode and pcode != "0":
                c = follow(custs.get(profile.plumber_prefix + pcode) if pcode.isdigit()
                           else custs.get(pcode))
                if c is not None:
                    return c
            tech = x.get("plumber_name") or ""
            hit = coupon_receipt_service.suggest_receiver(db, tech) if tech else None
            return follow(by_id.get(hit["id"])) if hit else None

        def rep_of(val: str, emp: str) -> User | None:
            code = emp_by_code.get(emp) or emp_by_uid.get(val)
            return users.get(profile.emp_to_user.get(code, "")) if code else None

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
            if kinds_known and kind not in kinds_known:
                notes[f"فئة كوبون غير معروفة «{kind}» — تُخطّت"] += 1
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
        issued = {(k, sr) for k, sr in db.execute(
            select(CouponIssueLine.coupon_kind, CouponIssueLine.serial)).all()}
        new_i = {}
        dup_lines = 0
        for k, v in issues.items():
            if profile.issue_ref(k[0], k[1], k[2], k[3]) in taken_i:
                continue
            fresh = [x for x in v if (k[2], x["serial"][:24]) not in issued]
            dup_lines += len(v) - len(fresh)
            if fresh:
                new_i[k] = fresh
        if dup_lines:
            print(f"   أوراق صرف متسجّلة قبل كده — اتخطّت{dup_lines:>17}")
        new_r = {k: v for k, v in receipts.items()
                 if profile.receipt_prefix + k not in taken_r}
        print(f"\n   {'مستندات صرف':<38}{len(issues):>7}   جديد {len(new_i)}")
        print(f"   {'أوراق فيها':<38}{sum(len(v) for v in new_i.values()):>7}")
        print(f"   {'مستندات استلام':<38}{len(receipts):>7}   جديد {len(new_r)}")
        print(f"   {'أوراق فيها':<38}{sum(len(v) for v in new_r.values()):>7}")
        mixed_k = sum(1 for v in new_r.values() if len({_kind(x['serial']) for x in v}) > 1)
        mixed_v = sum(1 for v in new_r.values()
                      if len({value_of(x) for x in v if value_of(x)}) > 1)
        print(f"   {'استلام بأكتر من فئة (بلا إقرار)':<38}{mixed_k:>7}")
        print(f"   {'استلام بأكتر من قيمة (بلا إقرار)':<38}{mixed_v:>7}")
        sides = Counter(
            coupon_receipt_service.receiver_side_of(p.customer_type) if p else "بلا حساب"
            for p in (receiver_of(v[0]) for v in new_r.values()))
        print(f"   {'المستلم منه حسب نوع الحساب':<38}"
              + " · ".join(f"{k}: {n}" for k, n in sides.most_common()))
        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        n_i = n_il = n_r = n_rl = 0
        seq = max((int(n[len(profile.issue_prefix):]) for (n,) in db.execute(
            select(CouponIssue.document_number).where(
                CouponIssue.document_number.like(f"{profile.issue_prefix}%"))).all()
            if n[len(profile.issue_prefix):].isdigit()), default=0)
        for (cid, d_dt, kind, rid), lines in new_i.items():
            ref = profile.issue_ref(cid, d_dt, kind, rid)
            doc = CouponIssue(
                document_number=f"{profile.issue_prefix}{seq + n_i + 1:06d}", branch_id=branch.id,
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
            vals = {value_of(x) for x in lines if value_of(x)}
            first = lines[0]
            rep = rep_of(first.get("rep_recv_emp", ""), first.get("rep_recv_emp", ""))
            tech = first.get("plumber_name") or ""
            party = receiver_of(first)
            doc = CouponReceipt(
                document_number=profile.receipt_prefix + rcode[:18], branch_id=branch.id,
                customer_id=party.id if party else None, rep_user_id=rep.id if rep else None,
                received_date=_date(first.get("recv_date", "")),
                coupon_count=len(lines),
                notes=(None if party else f"الفني: {tech}" if tech else None),
                customer_type=(coupon_receipt_service.receiver_side_of(party.customer_type)
                               if party else None),
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
    profile = profile_from_argv(args)
    run(dir_from_argv(args, profile), execute="--yes" in args, profile=profile)


if __name__ == "__main__":
    main()
