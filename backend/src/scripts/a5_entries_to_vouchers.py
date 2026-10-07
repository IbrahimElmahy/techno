"""قيود سندات a5 ⇒ سندات حقيقية في شاشة السندات (٢٠٢٦-١٠-٠٧).

    python -m src.scripts.a5_entries_to_vouchers --branch السادات --prefix FC-          # يعرض بس
    python -m src.scripts.a5_entries_to_vouchers --branch السادات --prefix FC- --yes
    python -m src.scripts.a5_entries_to_vouchers --branch أكتوبر --prefix "" --yes

النقل حط سندات a5 (قبض، صرف، مصروف…) **قيود** في الدفتر — الأرصدة صح، بس جدول السندات
فاضي من تاريخ a5، فشاشة «سند قبض / صرف / مصروف» بتقول «لا توجد» والفرع شغّال عليها من سنين.

**السند بيتعمل على نفس القيد** (`ledger_entry_id`) — مافيش قيد جديد ولا رقم بيتحرك. بيتصنّف
من سطري القيد:

* سطر على خزنة (`account_type = treasury`) والتاني مش خزنة:
  الخزنة مدين ⇒ قبض (أو إيداع شريك لو الطرف تحت جاري/رأس مال)،
  الخزنة دائن ⇒ صرف (أو مصروف لو الطرف حساب مصروفات، أو سحب شريك).
* الاتنين خزن ⇒ تحويل نقدي.
* غير كده (قيد بأكتر من سطرين، أو من غير خزنة) ⇒ قيد حر، بيفضل قيد.

الطرف: كارت العميل/المورد اللي الحساب بتاعه (والخط أبيض/بولي من الكارت)، وإلا الحساب نفسه.
الخزنة: صف جدول الخزن اللي على الحساب ده، والصندوق اللي في عهدة مندوب بيدّي المندوب.

**مُعلَّم:** `client_uuid = external_ref` (`a5:FC-33978`) ورقمه `<بادئة><نوع>-A5-<مفتاح>` — فبيتعرف إنه
من a5، والتشغيلة التانية بتتخطّاه، و`rebuild_a5_ledger`/`prune_a5_deleted_entries` بيشيلوه مع
قيده لما القيد يتعاد أو يتمسح (وبعدها السكربت ده بيرجّعه).
"""
from __future__ import annotations

import sys
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select, text

from src.core.db import SessionLocal
from src.models.customer import CustomerAccount
from src.models.ledger import Account, AccountType, Direction, LedgerEntry, LedgerLine
from src.models.org import Branch
from src.models.supplier import SupplierAccount
from src.models.treasury import Treasury
from src.models.voucher import Voucher, VoucherKind
from src.models.warehouse import Custody
from src.services.financial_reports_service import effective_nature
from src.models.ledger import AccountNature

PREFIX = {VoucherKind.receipt: "RCV", VoucherKind.payment: "PAY", VoucherKind.expense: "EXP",
          VoucherKind.cash_transfer: "TRF", VoucherKind.partner_withdraw: "PWD",
          VoucherKind.partner_deposit: "PDP"}
PARTNER_WORDS = ("جار", "رأس المال", "راس المال", "استثمار")
# مجموعات المصروفات بالاسم — شجرة السادات حساباتها من غير «طبيعة» فـ`effective_nature` مابيعرفهاش.
EXPENSE_WORDS = ("مصروف", "مصاريف", "اجور", "أجور", "مرتبات", "تكاليف", "اهلاك", "إهلاك", "ايجار")
# القيود المربوطة بمستند (فاتورة/مرتجع) — دول مش سندات.
DOC_LINKS = (("sales_invoice", "ledger_entry_id"), ("sales_return", "ledger_entry_id"),
             ("sales_return", "reversal_entry_id"), ("purchase_invoice", "ledger_entry_id"),
             ("purchase_return", "ledger_entry_id"), ("purchase_return", "reversal_entry_id"))


def run(*, branch_name: str, prefix: str, execute: bool) -> int:
    db = SessionLocal()
    try:
        bid = db.scalar(select(Branch.id).where(Branch.name == branch_name))
        tag = f"a5:{prefix}"
        entries = db.scalars(select(LedgerEntry).where(
            LedgerEntry.branch_id == bid, LedgerEntry.external_ref.like(tag + "%"))).all()
        # من غير بادئة (أكتوبر): المفتاح رقم بس — `a5:AL-…` و`a5:FC-…` مش بتوعنا.
        entries = [e for e in entries if prefix or e.external_ref[len(tag):].isdigit()]
        linked = {r for (r,) in db.execute(select(Voucher.ledger_entry_id)) if r}
        for t, c in DOC_LINKS:
            linked |= {r for (r,) in db.execute(text(f"select {c} from {t} where {c} is not null"))}
        entries = [e for e in entries if e.id not in linked]
        if not entries:
            print("مافيش قيود a5 من غير سند.")
            return 0
        lines: dict[int, list[LedgerLine]] = defaultdict(list)
        ids = [e.id for e in entries]
        for i in range(0, len(ids), 5000):
            for ln in db.scalars(select(LedgerLine).where(LedgerLine.entry_id.in_(ids[i:i + 5000]))):
                lines[ln.entry_id].append(ln)
        accs = {a.id: a for a in db.scalars(select(Account))}
        parents = {a.id: (accs[a.parent_id].name or "") if a.parent_id in accs else "" for a in accs.values()}
        cust_of = {ca.account_id: ca for ca in db.scalars(select(CustomerAccount))}
        supp_of = {sa.account_id: sa.supplier_id for sa in db.scalars(select(SupplierAccount))}
        treas_of = {t.account_id: t.id for t in db.scalars(select(Treasury)) if t.account_id}
        rep_of = {c.account_id: c.rep_id for c in db.scalars(select(Custody)) if c.account_id}
        taken = {r for (r,) in db.execute(select(Voucher.document_number))}

        made = defaultdict(int)
        skipped = defaultdict(int)
        new: list[Voucher] = []
        for e in entries:
            ls = lines.get(e.id, [])
            # الطرفين ممكن يفرقوا قروش — تصحيح القروش التراكمي (`fix_a5_rounding_balances`)
            # بيعدّل السطر الكسري بس. المبلغ بيتاخد من سطر الخزنة.
            if len(ls) != 2 or abs(ls[0].amount - ls[1].amount) > Decimal("0.05"):
                skipped["قيد بأكتر من سطرين"] += 1
                continue
            cash = [ln for ln in ls if accs[ln.account_id].account_type == AccountType.treasury]
            other = [ln for ln in ls if accs[ln.account_id].account_type != AccountType.treasury]
            to_treasury = None
            if len(cash) == 2:
                src = next(ln for ln in ls if ln.direction == Direction.credit)
                dst = next(ln for ln in ls if ln.direction == Direction.debit)
                kind, cash_ln, party_acc = VoucherKind.cash_transfer, src, dst.account_id
                to_treasury = treas_of.get(dst.account_id)
            elif len(cash) == 1:
                cash_ln, party_ln = cash[0], other[0]
                party_acc = party_ln.account_id
                pname = parents.get(party_acc, "")
                partner = any(w in pname for w in PARTNER_WORDS)
                if cash_ln.direction == Direction.debit:
                    kind = VoucherKind.partner_deposit if partner else VoucherKind.receipt
                elif partner:
                    kind = VoucherKind.partner_withdraw
                elif party_acc not in cust_of and party_acc not in supp_of and (
                        effective_nature(accs[party_acc]) == AccountNature.expense
                        or any(w in pname for w in EXPENSE_WORDS)):
                    kind = VoucherKind.expense
                else:
                    kind = VoucherKind.payment
            else:
                skipped["قيد حر (مافيهوش خزنة)"] += 1
                continue
            key = e.external_ref[len(tag):]
            number = f"{prefix}{PREFIX[kind]}-A5-{key}"[:24]
            if number in taken:
                skipped["الرقم موجود"] += 1
                continue
            taken.add(number)
            ca = cust_of.get(party_acc) if kind != VoucherKind.cash_transfer else None
            v = Voucher(
                document_number=number, kind=kind, amount=cash_ln.amount,
                customer_id=ca.customer_id if ca else None, family=ca.family if ca else None,
                supplier_id=supp_of.get(party_acc) if kind != VoucherKind.cash_transfer else None,
                rep_user_id=rep_of.get(cash_ln.account_id),
                cash_account_id=cash_ln.account_id, party_account_id=party_acc,
                treasury_id=treas_of.get(cash_ln.account_id), to_treasury_id=to_treasury,
                voucher_date=e.entry_date, description=(e.description or "")[:255] or None,
                external_document_number=key[:40], ledger_entry_id=e.id,
                actor_user_id=e.actor_user_id, branch_id=e.branch_id,
                client_uuid=e.external_ref[:64],
            )
            new.append(v)
            made[PREFIX[kind]] += 1

        print(f"فرع {branch_name}: قيود a5 من غير سند {len(entries)} · هيتعمل سند {len(new)}")
        for k, n in sorted(made.items(), key=lambda x: -x[1]):
            print(f"   {k:<4} {n}")
        for k, n in skipped.items():
            print(f"   اتساب ({k}): {n}")
        if not execute:
            print("\nعرض فقط — `--yes` للتنفيذ.")
            return 0
        db.add_all(new)
        db.commit()
        print(f"\n✔ اتعمل {len(new)} سند على قيودهم.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--branch" not in a or "--prefix" not in a:
        print("لازم --branch و--prefix.")
        sys.exit(2)
    sys.exit(run(branch_name=a[a.index("--branch") + 1], prefix=a[a.index("--prefix") + 1],
                 execute="--yes" in a))
