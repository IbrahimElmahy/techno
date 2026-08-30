"""يدمج الكروت المكررة اللي بتفرقها بادئة الدور بس — «فنى فلان» و«تكنو فلان» و«فلان».

    python -m src.scripts.merge_prefixed_dupes
    python -m src.scripts.merge_prefixed_dupes --yes

نظامهم القديم كان بيعلّم الدور في أول الاسم: «فنى» للفني، و«تكنو» للتاجر/الموزع.
والراجل الواحد اللي بيشتري وبيعاين وبيرجّع كوبونات كان بيتسجّل مرة لكل دور، فوصل
عندنا تلات كروت لشخص واحد — والبحث بيوريهم كلهم.

**بيتدمج اللي مافيش فيه شك بس.** المجموعة اللي أكتر من كارت فيها عليه حركة بتتخطى:
تشابه الاسم مش دليل — «احمد متولي» أربع كروت وكلهم عليهم شغل، ودول غالباً أربع ناس
مش راجل واحد. دمجهم بيخلط حسابات ناس مالهمش دعوة ببعض، وده أصعب في التصحيح من
التكرار نفسه.

**والمكرر بيتقفل مايتمسحش** (`active=False`) — يختفي من القوايم، وأي مرجع فاتنا
يفضل يلاقي صفه بدل ما يقع.
"""
from __future__ import annotations

import re
import sys
import unicodedata
from collections import defaultdict

from sqlalchemy import func, select, text

from src.core.db import SessionLocal
from src.models.coupon_issue import CouponIssue
from src.models.coupon_receipt import CouponReceipt
from src.models.customer import Customer, CustomerAccount
from src.models.inspection import Inspection
from src.models.sales import SalesInvoice
from src.services.customer_merge_service import _move_documents

AR = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ـ": ""})
# بادئات الدور في نظامهم — مش جزء من الاسم.
PREFIX = re.compile(r"^\s*(فنى|فني|تكنو|معرض|السباك|سباك|الاستاذ|أ/|م/)\s+")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", str(s or "")).translate(AR)
    s = "".join(c for c in s if not ("\u064b" <= c <= "\u0652"))
    s = " ".join(s.split())
    while True:
        cut = PREFIX.sub("", s)
        if cut == s:
            break
        s = cut
    return s.casefold().strip()


def run(*, execute: bool) -> None:
    db = SessionLocal()
    try:
        def tally(col):
            return dict(db.execute(select(col, func.count()).group_by(col)).all())

        activity = [tally(c) for c in (
            SalesInvoice.customer_id, Inspection.merchant_customer_id,
            Inspection.customer_id, CouponReceipt.customer_id, CouponIssue.customer_id)]
        accounts = defaultdict(int)
        for (cid,) in db.execute(select(CustomerAccount.customer_id)).all():
            accounts[cid] += 1

        def busy(cid: int) -> int:
            return sum(t.get(cid, 0) for t in activity)

        groups: dict[str, list[Customer]] = defaultdict(list)
        for c in db.scalars(select(Customer).where(Customer.active.is_(True))).all():
            n = norm(c.name)
            if n:
                groups[n].append(c)

        safe: list[tuple[Customer, list[Customer]]] = []
        skipped_busy = skipped_acc = 0
        for name, rows in groups.items():
            if len(rows) < 2:
                continue
            live = [c for c in rows if busy(c.id)]
            if len(live) > 1:
                skipped_busy += 1
                continue
            # الباقي اللي عليه الشغل، وإلا أقدم كارت (أصغر id) — ده اللي أغلب المراجع عليه.
            keep = live[0] if live else min(rows, key=lambda c: c.id)
            dupes = [c for c in rows if c.id != keep.id]
            # كارت فاضي من الحركة بس عليه حساب في الدفاتر مش فاضي فعلاً.
            if any(accounts.get(c.id) for c in dupes):
                skipped_acc += 1
                continue
            safe.append((keep, dupes))

        closing = sum(len(d) for _, d in safe)
        print(f"{'مجموعات مكررة':<34}{len(groups) and sum(1 for v in groups.values() if len(v) > 1):>6}")
        print(f"{'  آمنة للدمج':<34}{len(safe):>6}")
        print(f"{'  اتخطت — أكتر من كارت شغّال':<34}{skipped_busy:>6}")
        print(f"{'  اتخطت — المكرر عليه حساب':<34}{skipped_acc:>6}")
        print(f"{'كروت هتتقفل':<34}{closing:>6}")
        print("\nعينة:")
        for keep, dupes in safe[:10]:
            print(f"   يفضل: {keep.code:<16}{(keep.name or '')[:28]}")
            for d in dupes:
                print(f"      يتقفل: {d.code:<16}{(d.name or '')[:28]}")

        if not execute:
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        moved = {d.id: keep.id for keep, dupes in safe for d in dupes}
        stats = _move_documents(db, moved)
        # `merchant_customer_id` مش في `DOCUMENT_TABLES` — عمود تاني على نفس الجدول.
        n = 0
        for dupe_id, keep_id in moved.items():
            n += db.execute(text(
                "UPDATE inspection SET merchant_customer_id = :k "
                "WHERE merchant_customer_id = :d"), {"k": keep_id, "d": dupe_id}).rowcount or 0
        if n:
            stats["inspection.merchant_customer_id"] = n
        # ومندوب الخدمة ممكن يكون مشاور على كارت اتقفل.
        for dupe_id, keep_id in moved.items():
            db.execute(text("UPDATE customer SET service_rep_id = NULL "
                            "WHERE id = :d"), {"d": dupe_id})

        for keep, dupes in safe:
            for d in dupes:
                d.active = False
        db.commit()
        print("\nاتنقل:")
        for k, v in sorted(stats.items()):
            print(f"   {k:<34}{v:>6}")
        print(f"\n✔ اتقفل {closing} كارت مكرر. مااتمسحش ولا صف.")
    finally:
        db.close()


if __name__ == "__main__":
    run(execute="--yes" in sys.argv[1:])
