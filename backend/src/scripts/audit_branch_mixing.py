"""مستندات بتخلط فرعين — قراءة بس، ومابيكتبش حاجة.

    python -m src.scripts.audit_branch_mixing [--examples 5] [--days 30]

القاعدة الجديدة (`org_service.assert_same_branch`): مستند الفرع بيستخدم مخازن/عهد فرعه،
وخزن فرعه، وعملاء/موردين ومناديب فرعه (اللي مالوش فرع مشترك). السكربت ده بيعدّ القديم
اللي مايعدّيش القاعدة — أغلبه تاريخ a5 — عشان نعرف حجمه قبل ما الفحص يشتغل.

**مابيصلّحش.** القاعدة بتتفحص على الإنشاء والتعديل بس، والتعديل بيعدّي أي حاجة كانت على
المستند قبله (`keep`)، فالقديم بيتفتح ويتعدّل عادي. التصليح — لو اتقرر — سكربت تاني.

نفس قواعد الفرع اللي في `org_service` بالظبط، بس بخرائط محمّلة مرة واحدة بدل `db.get`
لكل صف:

* المخزن ⇒ `warehouse.branch_id`؛ العهدة ⇒ فرع مندوبها (أو مخزنها).
* حساب الكاش ⇒ العهدة الأول (حسابات عهد العلياء/السادات فرعها غلط = أكتوبر)، وبعدها
  صف `treasury`، وبعدها `account.branch_id`.
* فرع المستند ⇒ `branch_id` بتاعه، ولو فاضي فرع مكانه الأساسي.
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import text

from src.core.db import SessionLocal
from src.lib import stock_docs


def _rows(db, sql: str, **params):
    return db.execute(text(sql), params).all()


class Maps:
    """فرع كل حاجة — محمّل مرة واحدة."""

    def __init__(self, db):
        self.branch_name = {i: n for i, n in _rows(db, "select id, name from branch")}
        self.wh = {}
        self.wh_name = {}
        for i, b, n in _rows(db, "select id, branch_id, name from warehouse"):
            self.wh[i], self.wh_name[i] = b, n
        self.user = {}
        self.user_name = {}
        self.bound = {}
        for i, b, n, role in _rows(db, """
                select u.id, u.branch_id, coalesce(nullif(u.full_name, ''), u.username), r.name
                from "user" u join role r on r.id = u.role_id"""):
            self.user[i], self.user_name[i] = b, n
            # المحبوس في فرع = مش أدمن/مالك وليه فرع — نفس `bound_branch`.
            self.bound[i] = b if (b and role not in ("system_admin", "owner")) else None
        self.custody = {}
        self.custody_name = {}
        acc_from_custody = {}
        for i, rep, wh, acc, active in _rows(db, """
                select id, rep_id, warehouse_id, account_id, active from custody
                order by active desc, id"""):
            b = (self.user.get(rep) if rep else None) or (self.wh.get(wh) if wh else None)
            self.custody[i] = b
            self.custody_name[i] = (f"عهدة {self.user_name.get(rep)}" if rep else f"عهدة #{i}")
            if acc and acc not in acc_from_custody and b:
                acc_from_custody[acc] = b
        self.account = {}
        self.account_name = {}
        for i, b, n, c in _rows(db, "select id, branch_id, name, code from account"):
            self.account[i], self.account_name[i] = b, (n or c or f"#{i}")
        safes = _rows(db, "select id, branch_id, account_id, name from treasury")
        for _i, b, acc, _n in safes:
            if b:
                self.account[acc] = b
        self.account.update(acc_from_custody)    # العهدة بتغلب — شوف فوق
        self.treasury = {i: (b or self.account.get(acc)) for i, b, acc, _n in safes}
        self.treasury_name = {i: n for i, _b, _acc, n in safes}
        self.treasury_acc = {i: acc for i, _b, acc, _n in safes}
        # الخزنة المتوجّهة للفرع مسموحة له — نفس `org_service.routed_treasury_accounts`.
        self.routed = defaultdict(set)
        for b, acc in _rows(db, "select branch_id, account_id from account_routing "
                                "where role = 'treasury'"):
            self.routed[b].add(acc)
        self.customer = {i: b for i, b in _rows(db, "select id, branch_id from customer")}
        self.supplier = {i: b for i, b in _rows(db, "select id, branch_id from supplier")}

    def cash(self, acc_id, doc_branch):
        """فرع حساب الكاش — أو فرع المستند نفسه لو الحساب ده متوجّه له."""
        if acc_id and acc_id in self.routed.get(doc_branch, ()):
            return doc_branch
        return self.account.get(acc_id)

    def safe(self, treasury_id, doc_branch):
        if treasury_id and self.treasury_acc.get(treasury_id) in self.routed.get(doc_branch, ()):
            return doc_branch
        return self.treasury.get(treasury_id)

    def loc(self, kind, loc_id):
        if not kind or not loc_id:
            return None
        return self.wh.get(loc_id) if str(kind) == "warehouse" else self.custody.get(loc_id)

    def loc_label(self, kind, loc_id):
        if str(kind) == "warehouse":
            return f"مخزن «{self.wh_name.get(loc_id, loc_id)}»"
        return self.custody_name.get(loc_id, f"عهدة #{loc_id}")

    def bn(self, b):
        return self.branch_name.get(b, f"#{b}") if b else "—"


class Report:
    def __init__(self, maps: Maps, recent_from: date, examples: int):
        self.m = maps
        self.recent_from = recent_from
        self.examples = examples
        self.docs = defaultdict(set)        # (doc type, check) -> {doc ids}
        self.recent = defaultdict(set)
        self.samples = defaultdict(list)
        self.totals = {}                     # doc type -> docs scanned

    def hit(self, doc_type: str, check: str, doc_id, number, day, doc_branch, label, other):
        key = (doc_type, check)
        if doc_id in self.docs[key]:
            return
        self.docs[key].add(doc_id)
        if day and day >= self.recent_from:
            self.recent[key].add(doc_id)
        if len(self.samples[key]) < self.examples:
            self.samples[key].append(
                f"{number} ({day or '—'}) فرع المستند {self.m.bn(doc_branch)} ← {label} من {self.m.bn(other)}")

    def check(self, doc_type, check, doc_id, number, day, doc_branch, other, label):
        if doc_branch and other and other != doc_branch:
            self.hit(doc_type, check, doc_id, number, day, doc_branch, label, other)

    def print(self, info: dict):
        print("=" * 78)
        print(f"مستندات بتخلط فروع — «الأخيرة» = من {self.recent_from}")
        print("=" * 78)
        by_type = defaultdict(list)
        for (doc_type, check), ids in self.docs.items():
            by_type[doc_type].append((check, ids))
        for doc_type in self.totals:
            rows = by_type.get(doc_type, [])
            touched = set().union(*(ids for _c, ids in rows)) if rows else set()
            recent = set().union(*(self.recent[(doc_type, c)] for c, _ids in rows)) if rows else set()
            print(f"\n## {doc_type}: {len(touched)} مستند مخالف من {self.totals[doc_type]}"
                  f" (الأخيرة: {len(recent)})")
            for check, ids in sorted(rows, key=lambda r: -len(r[1])):
                print(f"   - {check}: {len(ids)} (الأخيرة: {len(self.recent[(doc_type, check)])})")
                for s in self.samples[(doc_type, check)]:
                    print(f"       · {s}")
        if info:
            print("\n## معلومات (مسموح — مش مخالفة)")
            for k, v in info.items():
                print(f"   - {k}: {v}")


def run(examples: int, days: int) -> int:
    db = SessionLocal()
    try:
        # قراءة بس — أي كتابة بالغلط بتترفض من القاعدة نفسها.
        db.execute(text("SET TRANSACTION READ ONLY"))
        m = Maps(db)
        rep = Report(m, date.today() - timedelta(days=days), examples)
        for t in ("فواتير البيع", "فواتير البونص", "مرتجعات البيع", "فواتير الشراء",
                  "مردودات الشراء", "أوامر البيع والشراء", "السندات", "الشيكات",
                  "أذون الإضافة والصرف", "مستندات الهالك", "الجرد", "تحويلات المخزون",
                  "أوامر التشغيل", "الإنتاج الحر"):
            rep.totals[t] = 0
        info: dict[str, object] = {}

        # ------------------------------------------------------------ فواتير البيع والبونص
        heads = {}
        for (i, num, day, b, ok, oid, cust, rep_id, cash_acc, cash, op_exp, bonus) in _rows(db, """
                select id, document_number, coalesce(invoice_date, created_at::date), branch_id,
                       origin_location_kind, origin_location_id, customer_id, rep_id,
                       cash_account_id, cash_amount, expenses_operating, coalesce(is_bonus, false)
                from sales_invoice"""):
            t = "فواتير البونص" if bonus else "فواتير البيع"
            db_b = b or m.loc(ok, oid)
            heads[i] = (t, num, day, db_b)
            rep.totals[t] = rep.totals.get(t, 0) + 1
            rep.check(t, "مخزن المستند", i, num, day, db_b, m.loc(ok, oid), m.loc_label(ok, oid))
            if (cash or 0) != 0 or (op_exp or 0) != 0:
                rep.check(t, "الخزنة", i, num, day, db_b, m.cash(cash_acc, db_b),
                          f"خزنة «{m.account_name.get(cash_acc)}»")
            rep.check(t, "العميل", i, num, day, db_b, m.customer.get(cust), f"عميل #{cust}")
            rep.check(t, "المندوب", i, num, day, db_b, m.user.get(rep_id),
                      f"مندوب «{m.user_name.get(rep_id)}»")
        for inv_id, lk, lid in db.execute(text(
                "select invoice_id, location_kind, location_id from sales_invoice_line "
                "where location_id is not null")).yield_per(20000):
            t, num, day, db_b = heads.get(inv_id, (None,) * 4)
            if t:
                rep.check(t, "مخزن سطر", inv_id, num, day, db_b, m.loc(lk, lid), m.loc_label(lk, lid))

        # ------------------------------------------------------------ مرتجعات البيع
        t = "مرتجعات البيع"
        rheads = {}
        for (i, num, day, b, ok, oid, cust, rep_id, cash_acc, refund, inv_b, inv_cust) in _rows(db, """
                select r.id, r.document_number, coalesce(r.return_date, r.created_at::date),
                       r.branch_id, r.origin_location_kind, r.origin_location_id,
                       coalesce(r.customer_id, i.customer_id), r.rep_id, r.cash_account_id,
                       r.cash_refund, i.branch_id, i.customer_id
                from sales_return r left join sales_invoice i on i.id = r.sales_invoice_id
                where r.reversed_at is null"""):
            db_b = b or inv_b or m.loc(ok, oid)
            rheads[i] = (num, day, db_b)
            rep.totals[t] = rep.totals.get(t, 0) + 1
            rep.check(t, "مخزن المستند", i, num, day, db_b, m.loc(ok, oid), m.loc_label(ok, oid) if oid else "")
            if (refund or 0) != 0 and cash_acc:
                rep.check(t, "الخزنة", i, num, day, db_b, m.cash(cash_acc, db_b),
                          f"خزنة «{m.account_name.get(cash_acc)}»")
            rep.check(t, "العميل", i, num, day, db_b, m.customer.get(cust), f"عميل #{cust}")
            rep.check(t, "المندوب", i, num, day, db_b, m.user.get(rep_id),
                      f"مندوب «{m.user_name.get(rep_id)}»")
        for rid, lk, lid in db.execute(text(
                "select return_id, location_kind, location_id from sales_return_line "
                "where location_id is not null")).yield_per(20000):
            if rid in rheads:
                num, day, db_b = rheads[rid]
                rep.check(t, "مخزن سطر", rid, num, day, db_b, m.loc(lk, lid), m.loc_label(lk, lid))

        # ------------------------------------------------------------ فواتير الشراء
        t = "فواتير الشراء"
        pheads = {}
        for (i, num, day, b, lk, lid, sup, rep_id) in _rows(db, """
                select id, document_number, coalesce(purchase_date, created_at::date), branch_id,
                       location_kind, location_id, supplier_id, rep_id from purchase_invoice"""):
            db_b = b or m.loc(lk, lid)
            pheads[i] = (num, day, db_b)
            rep.totals[t] = rep.totals.get(t, 0) + 1
            rep.check(t, "مخزن المستند", i, num, day, db_b, m.loc(lk, lid), m.loc_label(lk, lid))
            rep.check(t, "المورد", i, num, day, db_b, m.supplier.get(sup), f"مورد #{sup}")
            rep.check(t, "المندوب", i, num, day, db_b, m.user.get(rep_id),
                      f"مندوب «{m.user_name.get(rep_id)}»")
        for pid, lk, lid in db.execute(text(
                "select invoice_id, line_location_kind, line_location_id from purchase_invoice_line "
                "where line_location_id is not null")).yield_per(20000):
            if pid in pheads:
                num, day, db_b = pheads[pid]
                rep.check(t, "مخزن سطر", pid, num, day, db_b, m.loc(lk, lid), m.loc_label(lk, lid))

        # ------------------------------------------------------------ مردودات الشراء
        t = "مردودات الشراء"
        prheads = {}
        for (i, num, day, b, lk, lid, sup, inv_b) in _rows(db, """
                select r.id, r.document_number, coalesce(r.return_date, r.created_at::date),
                       r.branch_id, coalesce(r.origin_location_kind, i.location_kind),
                       coalesce(r.origin_location_id, i.location_id),
                       coalesce(r.supplier_id, i.supplier_id), i.branch_id
                from purchase_return r left join purchase_invoice i on i.id = r.purchase_invoice_id
                where r.reversed_at is null"""):
            db_b = b or inv_b or m.loc(lk, lid)
            prheads[i] = (num, day, db_b)
            rep.totals[t] = rep.totals.get(t, 0) + 1
            rep.check(t, "مخزن المستند", i, num, day, db_b, m.loc(lk, lid), m.loc_label(lk, lid))
            rep.check(t, "المورد", i, num, day, db_b, m.supplier.get(sup), f"مورد #{sup}")
        for rid, lk, lid in _rows(db, "select return_id, line_location_kind, line_location_id "
                                      "from purchase_return_line where line_location_id is not null"):
            if rid in prheads:
                num, day, db_b = prheads[rid]
                rep.check(t, "مخزن سطر", rid, num, day, db_b, m.loc(lk, lid), m.loc_label(lk, lid))

        # ------------------------------------------------------------ أوامر البيع/الشراء
        t = "أوامر البيع والشراء"
        for (i, num, day, b, wh, cust, sup) in _rows(db, """
                select id, document_number, coalesce(order_date, created_at::date), branch_id,
                       warehouse_id, customer_id, supplier_id from trade_order"""):
            db_b = b or m.wh.get(wh)
            rep.totals[t] = rep.totals.get(t, 0) + 1
            rep.check(t, "المخزن", i, num, day, db_b, m.wh.get(wh), f"مخزن «{m.wh_name.get(wh)}»")
            rep.check(t, "العميل", i, num, day, db_b, m.customer.get(cust), f"عميل #{cust}")
            rep.check(t, "المورد", i, num, day, db_b, m.supplier.get(sup), f"مورد #{sup}")

        # ------------------------------------------------------------ السندات
        t = "السندات"
        transfers_cross = 0
        for (i, num, day, b, kind, cash_acc, party_acc, tr, to_tr, cust, sup, rep_id) in _rows(db, """
                select v.id, v.document_number, v.voucher_date, v.branch_id, v.kind,
                       v.cash_account_id, v.party_account_id, v.treasury_id, v.to_treasury_id,
                       v.customer_id, v.supplier_id, v.rep_user_id
                from voucher v
                where v.reverses_id is null
                  and not exists (select 1 from voucher r where r.reverses_id = v.id)"""):
            rep.totals[t] = rep.totals.get(t, 0) + 1
            cash_b = m.treasury.get(tr) if tr else m.account.get(cash_acc)
            if kind == "cash_transfer":
                # التحويل بين خزنتين من فرعين مسموح — بيتعدّ بس.
                if cash_b and m.treasury.get(to_tr) and cash_b != m.treasury.get(to_tr):
                    transfers_cross += 1
                continue
            db_b = b or cash_b
            rep.check(t, "الخزنة", i, num, day, db_b,
                      m.safe(tr, db_b) if tr else m.cash(cash_acc, db_b),
                      f"خزنة «{m.treasury_name.get(tr) or m.account_name.get(cash_acc)}»")
            rep.check(t, "العميل", i, num, day, db_b, m.customer.get(cust), f"عميل #{cust}")
            rep.check(t, "المورد", i, num, day, db_b, m.supplier.get(sup), f"مورد #{sup}")
            rep.check(t, "المندوب", i, num, day, db_b, m.user.get(rep_id),
                      f"مندوب «{m.user_name.get(rep_id)}»")
        info["تحويلات نقدية بين خزن فرعين"] = transfers_cross

        # ------------------------------------------------------------ الشيكات
        t = "الشيكات"
        for (i, num, day, tr, cust, sup, actor) in _rows(db, """
                select id, document_number, issue_date, treasury_id, customer_id, supplier_id,
                       actor_user_id from cheque"""):
            rep.totals[t] = rep.totals.get(t, 0) + 1
            db_b = m.bound.get(actor) or m.treasury.get(tr) or m.customer.get(cust) or m.supplier.get(sup)
            rep.check(t, "الخزنة", i, num, day, db_b, m.safe(tr, db_b), f"خزنة «{m.treasury_name.get(tr)}»")
            rep.check(t, "العميل", i, num, day, db_b, m.customer.get(cust), f"عميل #{cust}")
            rep.check(t, "المورد", i, num, day, db_b, m.supplier.get(sup), f"مورد #{sup}")

        # ------------------------------------------------------------ أذون/هالك (مكان واحد)
        # المستند مخزن واحد فمايخلطش جوّاه — المخالفة الوحيدة إن موظف فرع كتبه على مخزن فرع تاني.
        for t, sql in (
            ("أذون الإضافة والصرف", "select id, document_number, coalesce(permit_date, created_at::date), "
                                    "warehouse_id, actor_user_id from stock_permit where reverses_id is null"),
            ("مستندات الهالك", "select id, document_number, created_at::date, warehouse_id, actor_user_id "
                               "from wastage_document where reverses_id is null"),
        ):
            for i, num, day, wh, actor in _rows(db, sql):
                rep.totals[t] = rep.totals.get(t, 0) + 1
                rep.check(t, "موظف فرع على مخزن فرع تاني", i, num, day, m.bound.get(actor),
                          m.wh.get(wh), f"مخزن «{m.wh_name.get(wh)}»")

        # ------------------------------------------------------------ الجرد
        t = "الجرد"
        spans = defaultdict(set)
        for cid, wh in _rows(db, "select count_id, warehouse_id from stock_count_line"):
            if m.wh.get(wh):
                spans[cid].add(m.wh.get(wh))
        for i, num, day, wh, actor, status in _rows(db, """
                select id, document_number, count_date, warehouse_id, actor_user_id, status
                from stock_count"""):
            rep.totals[t] = rep.totals.get(t, 0) + 1
            if len(spans.get(i, ())) > 1:
                rep.hit(t, "جرد عام على أكتر من فرع", i, num, day, None,
                        "، ".join(m.bn(b) for b in sorted(spans[i])), None)
            rep.check(t, "موظف فرع على مخزن فرع تاني", i, num, day, m.bound.get(actor),
                      m.wh.get(wh), f"مخزن «{m.wh_name.get(wh)}»")

        # ------------------------------------------------------------ التحويلات
        t = "تحويلات المخزون"
        pairs = defaultdict(int)
        for (i, num, day, sk, sid, dk, did, actor) in _rows(db, """
                select id, document_number, coalesce(transfer_date, created_at::date),
                       source_location_kind, source_location_id, dest_location_kind,
                       dest_location_id, initiated_by
                from stock_transfer where status <> 'rejected'"""):
            rep.totals[t] = rep.totals.get(t, 0) + 1
            fb, tb = m.loc(sk, sid), m.loc(dk, did)
            if fb and tb and fb != tb:
                pairs[(fb, tb)] += 1
            bound = m.bound.get(actor)
            if bound and {x for x in (fb, tb) if x} and bound not in {fb, tb}:
                rep.hit(t, "طلبه موظف فرع مش طرف فيه", i, num, day, bound,
                        f"{m.bn(fb)} → {m.bn(tb)}", bound)
        for (fb, tb), n in sorted(pairs.items()):
            info[f"تحويلات مخزون {m.bn(fb)} → {m.bn(tb)} (مسموح)"] = n

        # ------------------------------------------------------------ التصنيع (من حركاته)
        for t, table, doc in (("أوامر التشغيل", "manufacturing_order", stock_docs.StockDoc.MANUFACTURING),
                              ("الإنتاج الحر", "production_order", "production_order")):
            # الاسم بالظبط مش البدايل: `manufacturing` القديم رقمه رقم عملية مش رقم أمر.
            names = [doc]
            heads = {i: (num, b) for i, num, b in _rows(
                db, f"select id, document_number, branch_id from {table}")}
            rep.totals[t] = len(heads)
            for sid, lk, lid in _rows(db, """
                    select distinct source_doc_id, location_kind, location_id from stock_movement
                    where source_doc_type = any(:names)""", names=names):
                if sid in heads:
                    num, b = heads[sid]
                    rep.check(t, "مخزن حركة", sid, num, None, b, m.loc(lk, lid), m.loc_label(lk, lid))

        rep.print(info)
        return 0
    finally:
        db.rollback()
        db.close()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--examples", type=int, default=5)
    p.add_argument("--days", type=int, default=30, help="«الأخيرة» = آخر كام يوم")
    a = p.parse_args(argv)
    return run(a.examples, a.days)


if __name__ == "__main__":
    sys.exit(main())
