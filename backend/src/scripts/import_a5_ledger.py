from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select

from src.core.db import SessionLocal
from src.core.money import to_money
from src.models.ledger import Account, Direction, LedgerEntry, LedgerLine
from src.models.org import Branch
from src.models.purchasing import PurchaseInvoice, PurchaseReturn
from src.models.sales import SalesInvoice, SalesReturn
from src.models.user import User
from src.scripts.import_a5 import _clean, _money, _read

ZERO = Decimal("0")

(A_KEY, A_DATE, A_ACC, A_ACCNAME, A_IN, A_OUT, A_DESC, A_TYPE, A_DOC,
 A_VOUCHER, A_CAT, A_ID) = range(12)

DOCS = {
    "7": ("S", SalesInvoice, "sales_invoice"),
    "2": ("SR", SalesReturn, "sales_return"),
    "1": ("P", PurchaseInvoice, "purchase_invoice"),
    "11": ("PR", PurchaseReturn, "purchase_return"),
}


def _date(v: str) -> date | None:
    try:
        return datetime.strptime((v or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _group_key(r: list[str], mode: str) -> str:
    if mode == "doc":
        return f"{_clean(r[A_TYPE])}/{_clean(r[A_DOC])}"
    return r[A_KEY]


ROUNDING_TOLERANCE = Decimal("1.00")


def _absorb_rounding(lines: list[LedgerLine]) -> Decimal:
    debit = sum((ln.amount for ln in lines if ln.direction == Direction.debit), ZERO)
    credit = sum((ln.amount for ln in lines if ln.direction == Direction.credit), ZERO)
    diff = debit - credit
    if diff == ZERO or abs(diff) > ROUNDING_TOLERANCE:
        return ZERO
    side = Direction.credit if diff > ZERO else Direction.debit
    target = max((ln for ln in lines if ln.direction == side),
                 key=lambda ln: ln.amount, default=None)
    if target is None:
        return ZERO
    target.amount = to_money(target.amount + abs(diff))
    return abs(diff)


def run(folder: str, *, execute: bool, branch_name: str = "", prefix: str = "",
        key_mode: str = "mmstnd") -> None:
    rows = [r for r in _read(os.path.join(folder, "a5_acclines.tsv")) if len(r) >= 12]

    groups: dict[str, list[list[str]]] = defaultdict(list)
    for r in rows:
        groups[_group_key(r, key_mode)].append(r)

    kinds: dict[str, int] = defaultdict(int)
    for g in groups.values():
        kinds[g[0][A_TYPE]] += 1

    print("المصدر:")
    print(f"   سطور الدفتر          {len(rows):>7}")
    print(f"   قيود (sysfree)       {len(groups):>7}")
    for t, n in sorted(kinds.items(), key=lambda x: -x[1]):
        label = {"0": "أرصدة افتتاحية", "7": "بيع", "1": "شرا", "2": "مردود بيع",
                 "11": "مردود شرا", "17": "سندات وقيود"}.get(t, f"نوع {t}")
        print(f"      {label:<18}{n:>7}")
    if not execute:
        print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
        return

    db = SessionLocal()
    made: dict[str, int] = defaultdict(int)
    skipped: list[str] = []
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit("مافيش فرع اسمه " + branch_name)
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        admin = db.scalars(select(User).order_by(User.id)).first()
        print("الفرع المستهدف: " + branch.name
              + ((" · البادئة: " + prefix) if prefix else "") + "\n")

        acc_by_code = {a.code: a for a in db.scalars(select(Account)).all() if a.code}
        done = {r for (r,) in db.execute(
            select(LedgerEntry.external_ref).where(
                LedgerEntry.external_ref.is_not(None))).all()}

        doc_rows: dict[str, object] = {}
        for _tag, model, _kind in DOCS.values():
            for row in db.scalars(select(model).where(model.branch_id == branch.id)).all():
                doc_rows[row.document_number] = row

        by_ref = {e.external_ref: e for e in db.scalars(
            select(LedgerEntry).where(LedgerEntry.external_ref.is_not(None))).all()}

        def link(a5_type: str, a5_doc: str, entry: LedgerEntry) -> None:
            if a5_type not in DOCS or a5_doc in ("0", ""):
                return
            row = doc_rows.get(f"{prefix}{DOCS[a5_type][0]}{a5_doc}")
            if row is not None and getattr(row, "ledger_entry_id", None) is None:
                row.ledger_entry_id = entry.id
                made["فواتير اتربطت بقيدها"] += 1

        for key in sorted(groups, key=lambda k: (groups[k][0][A_DATE], str(k))):
            g = groups[key]
            ref = f"a5:{prefix}{key}"
            if ref in done:
                entry = by_ref.get(ref)
                if entry is not None:
                    link(g[0][A_TYPE], g[0][A_DOC], entry)
                continue
            a5_type, a5_doc = g[0][A_TYPE], g[0][A_DOC]

            lines: list[LedgerLine] = []
            for r in g:
                acc = acc_by_code.get(f"{prefix}A5S-{_clean(r[A_ACC])}")
                if acc is None:
                    skipped.append(f"حساب مش موجود: «{_clean(r[A_ACCNAME])}»")
                    continue
                debit, credit = to_money(_money(r[A_IN])), to_money(_money(r[A_OUT]))
                if debit == ZERO and credit == ZERO:
                    continue
                out = credit > debit
                lines.append(LedgerLine(
                    account_id=acc.id,
                    direction=Direction.credit if out else Direction.debit,
                    amount=credit if out else debit,
                    statement=_clean(r[A_DESC])[:255] or None))
            if not lines:
                continue
            _absorb_rounding(lines)

            kind = (DOCS[a5_type][2] if a5_type in DOCS
                    else "opening_balance" if a5_type == "0" else "journal")

            entry = LedgerEntry(
                entry_type=kind, external_ref=ref,
                description=_clean(g[0][A_DESC])[:255] or _clean(g[0][A_CAT])[:255],
                entry_date=_date(g[0][A_DATE]), branch_id=branch.id,
                actor_user_id=admin.id)
            db.add(entry)
            db.flush()
            for ln in lines:
                ln.entry_id = entry.id
                db.add(ln)
            done.add(ref)
            by_ref[ref] = entry
            made[kind] += 1
            made["سطور"] += len(lines)

            link(a5_type, a5_doc, entry)

        db.commit()
        print(f"{'الكيان':<26}{'اتعمل':>8}")
        print("-" * 36)
        for k, v in sorted(made.items()):
            print(f"{k:<26}{v:>8}")
        if skipped:
            counts: dict[str, int] = defaultdict(int)
            for s in skipped:
                counts[s] += 1
            print(f"\nاتخطّى {len(skipped)} سطر، {len(counts)} سبب:")
            for s, n in sorted(counts.items(), key=lambda x: -x[1])[:15]:
                print(f"   {n:>6} × {s}")
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp"
    target = args[args.index("--branch") + 1] if "--branch" in args else ""
    pref = args[args.index("--prefix") + 1] if "--prefix" in args else ""
    mode = args[args.index("--key") + 1] if "--key" in args else "mmstnd"
    run(folder, execute="--yes" in args, branch_name=target, prefix=pref, key_mode=mode)
