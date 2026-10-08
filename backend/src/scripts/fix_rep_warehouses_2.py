from __future__ import annotations

import sys

from sqlalchemy import func, select

from src.core.db import SessionLocal
from src.models.employee import Employee
from src.models.sales import SalesInvoice
from src.models.stock import StockMovement
from src.models.user import User
from src.models.warehouse import Warehouse

PAIRS: list[tuple[str, str, str]] = [
    ("fayoum", "مخزن سياره 1", "٣٬٠٦٨ حركة · ٩٩٪"),
    ("amr.ragab", "مخزن سياره 2", "٤٬٨٨٠ حركة · ٨٥٪"),
    ("herafyeen", "مخزن سياره 2", "٥٦٦ حركة · ٩٩٪"),
    ("giza2", "مخزن سياره 2", "١٩٠ حركة · ٩٩٪"),
    ("branches", "المخزن الرئيسى", "٣٨٩ حركة · ٧٢٪"),
    ("sales.dept2", "المخزن الرئيسى", "٣٣٠ حركة · ٨٥٪"),
]

UNLINK: list[str] = ["rep"]


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        def real_source(user_id: int) -> tuple[str, int, int]:
            rows = db.execute(
                select(StockMovement.location_id, func.count())
                .join(SalesInvoice, SalesInvoice.id == StockMovement.source_doc_id)
                .where(SalesInvoice.rep_id == user_id,
                       StockMovement.source_doc_type == "sales_invoice",
                       StockMovement.location_kind == "warehouse")
                .group_by(StockMovement.location_id)
                .order_by(func.count().desc())).all()
            if not rows:
                return ("— مافيش حركات —", 0, 0)
            total = sum(n for _lid, n in rows) or 1
            top_id, top_n = rows[0]
            w = db.get(Warehouse, top_id)
            return (w.name if w else f"#{top_id}", top_n, top_n * 100 // total)

        plan: list[tuple[Employee, User, Warehouse, Warehouse | None, str]] = []
        problems: list[str] = []

        for username, wh_name, measured in PAIRS:
            u = db.scalar(select(User).where(User.username == username))
            whs = db.scalars(select(Warehouse).where(Warehouse.name == wh_name)).all()
            if u is None or len(whs) != 1:
                problems.append(f"«{username}» → «{wh_name}»: "
                                f"{'مافيش مستخدم' if u is None else f'{len(whs)} مخزن'}")
                continue
            emp = db.scalar(select(Employee).where(Employee.user_id == u.id))
            if emp is None:
                problems.append(f"«{username}»: مالوش كارت موظف — الربط بيتكتب عليه")
                continue
            wh = whs[0]
            real_name, n, pct = real_source(u.id)
            if real_name != wh_name:
                problems.append(f"«{username}»: الجدول بيقول «{wh_name}» "
                                f"والحركات دلوقتي بتقول «{real_name}» ({n}) — اتخطّى")
                continue
            if emp.warehouse_id == wh.id:
                continue
            old = db.get(Warehouse, emp.warehouse_id) if emp.warehouse_id else None
            plan.append((emp, u, wh, old, f"{n} حركة · {pct}٪"))

        unlink: list[tuple[Employee, User, Warehouse]] = []
        for username in UNLINK:
            u = db.scalar(select(User).where(User.username == username))
            if u is None:
                continue
            emp = db.scalar(select(Employee).where(Employee.user_id == u.id))
            if emp is not None and emp.warehouse_id:
                w = db.get(Warehouse, emp.warehouse_id)
                if w is not None:
                    unlink.append((emp, u, w))

        print(f"{'المندوب':<16}{'من':<24}{'إلى':<22}{'المقاس من الحركات'}")
        print("-" * 84)
        for emp, u, wh, old, measured in plan:
            print(f"{u.username:<16}{(old.name if old else '—')[:22]:<24}"
                  f"{wh.name[:20]:<22}{measured}")
        print(f"\nهيتصلّح: {len(plan)}")

        if unlink:
            print(f"\nهيتفكّ منهم المخزن ({len(unlink)}) — ماسكين مخزن حد تاني:")
            for emp, u, w in unlink:
                real_name, n, pct = real_source(u.id)
                print(f"   {u.username:<16}كان على «{w.name}»   "
                      f"وحركاته في «{real_name}» ({n} · {pct}٪)")

        if problems:
            print(f"\n⚠️ مش هيتغيّروا ({len(problems)}):")
            for p in problems:
                print(f"   {p}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        for emp, _u, _w in unlink:
            emp.warehouse_id = None
        db.flush()
        for emp, _u, wh, _old, _m in plan:
            emp.warehouse_id = wh.id
        db.commit()

        print("\nبعد التصحيح:")
        for username, wh_name, _m in PAIRS:
            u = db.scalar(select(User).where(User.username == username))
            emp = db.scalar(select(Employee).where(Employee.user_id == u.id)) if u else None
            w = db.get(Warehouse, emp.warehouse_id) if emp and emp.warehouse_id else None
            n = db.scalar(
                select(func.count()).select_from(StockMovement)
                .where(StockMovement.location_id == w.id,
                       StockMovement.location_kind == "warehouse")) if w else 0
            mark = "✔" if w and w.name == wh_name else "✘"
            print(f"{mark} {username:<16}{(w.name if w else '—')[:22]:<24}"
                  f"{n or 0:>7} حركة في المخزن")
        for _emp, u, _w in unlink:
            e = db.scalar(select(Employee).where(Employee.user_id == u.id))
            print(f"✔ {u.username:<16}"
                  f"{'اتفكّ' if e and e.warehouse_id is None else '⚠ لسه مربوط'}")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
