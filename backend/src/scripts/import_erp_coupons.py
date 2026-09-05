"""يستورد حركة الكوبونات من نظام ما بعد البيع القديم: الصرف للتاجر والاستلام من الفني.

    python -m src.scripts.import_erp_coupons --dir C:/pgtmp/erp --branch العلياء
    python -m src.scripts.import_erp_coupons --dir C:/pgtmp/erp --branch العلياء --yes

بيتعاد تشغيله بأمان: المستند اللي مرجعه موجود بيتخطى، والورقة اللي اتسجّلت بتتخطى.

بياخد ملفين، وكل واحد فيهم من مصدر مختلف **لأنه المصدر الوحيد اللي عنده الحقيقة**:

* `coupons.tsv` — الحركة، من `erp.dbo.wh_transDCoupon` مباشرة. القاعدة شغّالة عند العميل
  دلوقتي، وهي اللي بيتقاس عليها. الأعمدة بالترتيب:
  `DetailId~NumCoupon~DistributorId~PlumberId~TrandateDelivery~TransdateReceipt~
   CodeReceipt~valuecoupon~salesrepid~SalesRepIdDelivery~Status~Notes`

* `coupon_parties.tsv` — خريطة أكواد الأطراف. **دي مش موجودة في `erp` خالص**؛ العميل
  كتبها بإيده في ملف إكسل («كود تاجر A5»، «كود بعد تعديل A5»، «كود جديد» للمندوب).
  من غيرها مافيش طريق من رقم التاجر عندهم لكارت العميل عندنا. سطر لكل طرف:
  `D|P|R ~ كود ERP ~ كود عندنا (A5-… / AL-A5-… / EMP-…) ~ الاسم ~ trader|plumber|rep`

---------------------------------------------------------------------------
اللي القراءة الأولى بتغلط فيه — واتقاس على القاعدة الحيّة مش على الملف:

* **`ProgDelete` مش علامة حذف.** الاسم بيقول كده والمحتوى بيقول العكس: `new/138` أو
  `Edit/1308` — ختم عملية الاستلام ورقمها. ١٢٥٦٧ صف عليهم ختم، وهم بالظبط الصفوف اللي
  ليها تاريخ استلام. لو اتعاملنا معاه كحذف، الاستلامات كلها تروح.

* **اللي بيتشال فعلاً `Status = 0`.** ١٦٣ صف: مالهمش تاجر ومارجعوش من حد — ورق اتلغى.
  الباقي (٢٣٧٩٠) شغّال.

* **`DistributorId = 0` يعني الورقة لسه في الدرج.** ٤٠٦٧ صف كمان — اتطبعت ومااتصرفتش.
  مابتتنسبش لحد. (١٦٣ + ٤٠٦٧ = ٤٢٣٠ صف بره، والباقي ١٩٧٢٣ هو نفسه اللي في ملف العميل.)

* **`MerchantId` عمود ميّت** — صفر على الـ٢٣٩٥٣ صف كلهم. التاجر هو `DistributorId`.

* **`valuecoupon` قيمة الاستلام مش قيمة الصرف.** فاضية على الـ١١٣٨٦ ورقة اللي مارجعتش،
  ومتحطوطة على الـ١٢٥٦٧ اللي رجعت — ١٣٥ و١٦٥ للذهبي، ٤٥ و٥٥ للفضي. دي اللي اتدفعت
  للفني ساعة ما سلّم، فمكانها `declared_value` على الاستلام، مش `unit_value` على الصرف.

---------------------------------------------------------------------------
وقرارات النقل:

* **الورقة بتخرج مرتين في حياتها.** بتتصرف لتاجر (`TrandateDelivery`) وبترجع من فني
  (`TransdateReceipt`). الاتنين مستندين مختلفين عندنا: «صرف كوبونات» و«استلام كوبونات».

* **مستند الاستلام موجود عندهم بالاسم: `CodeReceipt`.** ١٤٧٨ رقم، وكل رقم عليه فني واحد
  وتاريخ واحد ومندوب واحد. فالتجميع بيتم عليه هو، مش على (فني + يوم): التجميع بالإيد
  بيطلع ١٤١٦ مجموعة — بيلحّم مستندين ويشرشر واحد.

* **مستند الصرف مالوش رقم يتمسك بيه.** `CodeDelivery` بيتكرر (١٢٢٥ قيمة على ١٦٨٦ تركيبة
  تاجر×يوم)، فبيتبني من (تاجر + يوم + فئة + مندوب التسليم). المندوب داخل في المفتاح لأن
  ٣ مجموعات من غيره بتخلط مندوبين، والمستند وقتها بيكدب على واحد فيهم.

* **الفئة جوّه الرقم.** `NumCoupon` = «ذهبى-536000» → فئة ورقم. هوية الكوبون عندنا (الفئة
  + الرقم) — و«٥ ذهبي» غير «٥ فضي». والفئة بتتطوى (ى→ي) عشان تقع على قايمة `coupon_kind`
  عندنا: «ذهبى»→«ذهبي». **الطي على الفئة بس** — دي تسمية صنف؛ أسماء الناس مابتتطويش،
  والهمزة مابتتلمسش أبداً (a5 بيفرّق بيها بين ناس).

* **التاجر بالكود، مستحيل بالاسم.** ERP بيقول «تكنو محمد الجزار» وكارتنا بيقول «محمد
  الجزار» — نفس الراجل باسمين. الكود `AL-A5-424` هو اللي بيوصّل.

* **الفني في الغالب مالوش كارت.** ٣٩٩ من الـ٤٤١ اللي رجّعوا ورق سباكين مش مسجّلين في a5،
  و٤١ تجار ليهم كارت. اللي مالوش كارت اسمه وكوده بيتكتبوا في `notes` والمستند بيفضل
  بغير عميل — اختراع كارت ليه بيدخّل في كشف العملاء ناس صاحب الشغل مادخّلهمش.

* **الإقرار بيتكتب لما الدفعة تتفق.** ٤٦٣ مستند استلام فيهم أكتر من فئة و٢٧١ فيهم أكتر
  من قيمة. `declared_kind` و`declared_value` إقرار واحد قاله المندوب؛ دفعة مخلوطة مالهاش
  إقرار واحد، فبيفضلوا فاضيين والسطر هو اللي شايل الفئة.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation

from sqlalchemy import select

from src.core.db import SessionLocal
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceipt, CouponReceiptLine
from src.models.customer import Customer
from src.models.employee import Employee
from src.models.lookup import LookupOption
from src.models.org import Branch
from src.models.user import User
from src.scripts.import_a5 import _clean, _read

# أعمدة `coupons.tsv` — نفس ترتيب التصدير الموصوف فوق.
(C_ID, C_SERIAL, C_DIST, C_PLUMB, C_DELIV, C_RECV, C_RCODE, C_VALUE,
 C_REP_R, C_REP_D, C_STATUS, C_NOTES) = range(12)

# أعمدة `coupon_parties.tsv`
(P_KIND, P_ERP, P_CODE, P_NAME, P_TYPE) = range(5)

# صف ملغي عندهم. (مش `ProgDelete` — ده ختم عملية مش علامة حذف.)
VOID = "0"


def _date(v: str) -> date | None:
    """تاريخ النظام القديم رقم `yyyymmdd`."""
    v = (v or "").strip()
    if len(v) != 8 or not v.isdigit():
        return None
    try:
        return date(int(v[:4]), int(v[4:6]), int(v[6:]))
    except ValueError:
        return None


def _kind(raw: str) -> str:
    """«ذهبى» → «ذهبي». قايمة `coupon_kind` عندنا مكتوبة بالياء، ونظامهم بالألف المقصورة.

    الطي هنا على تسمية فئة مش على اسم إنسان — والهمزة مابتتلمسش في الحالتين.
    """
    return (raw or "").replace("ى", "ي").strip()


def _split(num: str) -> tuple[str, str]:
    """«ذهبى-536000» → («ذهبي», «536000»). نظامهم كاتب الفئة جوّه الرقم."""
    num = _clean(num)
    kind, _sep, serial = num.partition("-")
    kind, serial = kind.strip(), serial.strip()
    if kind and serial:
        return _kind(kind), serial
    return "", num


def _money(v: str) -> Decimal | None:
    v = (v or "").strip()
    if not v:
        return None
    try:
        return Decimal(v)
    except (InvalidOperation, ValueError):
        return None


def _note(raw: str, kind: str) -> str:
    """الـNotes عندهم بيكرر الفئة على ١٤٥٣ صف. ده مش ملاحظة، ده ضجيج."""
    n = _clean(raw)
    return "" if not n or _kind(n) == kind else n


def _one(values: set) -> object | None:
    """قيمة الدفعة لو الدفعة متفقة، وإلا لا شيء — الإقرار المخلوط مش إقرار."""
    real = {v for v in values if v not in (None, "")}
    return real.pop() if len(real) == 1 else None


def _ensure_kinds(db, kinds: set[str]) -> list[str]:
    """الفئة اللي مش في القايمة بتتزاد — الشاشة بتقرا منها، والفئة الغايبة بتظهر فاضية."""
    have = {o.value for o in db.scalars(
        select(LookupOption).where(LookupOption.category == "coupon_kind")).all()}
    order = max([o.sort_order for o in db.scalars(
        select(LookupOption).where(LookupOption.category == "coupon_kind")).all()] or [0])
    added = []
    for k in sorted(kinds - have):
        if not k:
            continue
        order += 1
        db.add(LookupOption(category="coupon_kind", value=k, label=k,
                            sort_order=order, active=True, is_system=False))
        added.append(k)
    return added


def _show_unresolved(unresolved: dict[str, dict[str, int]]) -> None:
    """اللي مالوش كارت بيتقال بالاسم والعدد — الرقم لوحده مش بيتصلّح."""
    for why in sorted(unresolved):
        who = unresolved[why]
        papers = sum(who.values())
        print(f"\n{why} — {len(who)} طرف / {papers} ورقة:")
        for w, n in sorted(who.items(), key=lambda kv: (-kv[1], kv[0]))[:25]:
            print(f"    {w}   ({n} ورقة)")
        if len(who) > 25:
            print(f"    … و{len(who) - 25} غيرهم")


def run(folder: str, *, execute: bool, branch_name: str = "") -> None:
    rows = [r for r in _read(os.path.join(folder, "coupons.tsv")) if len(r) >= 12]
    party = [r for r in _read(os.path.join(folder, "coupon_parties.tsv")) if len(r) >= 5]

    # الطرف بكوده عندهم → (كودنا، الاسم، النوع). المندوب في قايمة لوحده.
    trade = {r[P_ERP]: r for r in party if r[P_KIND] in ("D", "P") and r[P_ERP]}
    reps = {r[P_ERP]: r[P_CODE] for r in party
            if r[P_KIND] == "R" and r[P_ERP].isdigit() and r[P_CODE].startswith("EMP-")}

    issues: dict[tuple, list[list[str]]] = defaultdict(list)
    receipts: dict[str, list[list[str]]] = defaultdict(list)
    dropped: dict[str, int] = defaultdict(int)
    kinds: set[str] = set()
    for r in rows:
        if r[C_STATUS] == VOID:
            dropped["ملغي عندهم (Status = 0)"] += 1
            continue
        kind, serial = _split(r[C_SERIAL])
        if not serial:
            dropped["رقم كوبون فاضي"] += 1
            continue
        if r[C_DIST] in ("0", ""):
            dropped["مااتصرفش لحد (DistributorId = 0)"] += 1
            continue
        if _date(r[C_DELIV]) is None:
            dropped["تاريخ صرف غلط"] += 1
            continue
        kinds.add(kind)
        issues[(r[C_DIST], r[C_DELIV], kind, r[C_REP_D])].append(r)
        if _date(r[C_RECV]) is None:
            continue
        if not r[C_RCODE].isdigit() or r[C_RCODE] == "0":
            # رجعت من غير رقم مستند — مافيش حاجة نجمّعها عليها، والاختراع بيلحّم غرايب.
            dropped["رجعت من غير CodeReceipt"] += 1
            continue
        receipts[r[C_RCODE]].append(r)

    print("المصدر:")
    print(f"   صفوف الملف            {len(rows):>7}")
    print(f"   أطراف في الخريطة      {len(trade) + len(reps):>7}")
    for why, n in sorted(dropped.items(), key=lambda kv: -kv[1]):
        print(f"   {why:<34}{n:>7}   (هتتخطى)")
    print(f"\n   مستندات صرف           {len(issues):>7}   "
          f"({sum(len(v) for v in issues.values())} ورقة)")
    print(f"   مستندات استلام        {len(receipts):>7}   "
          f"({sum(len(v) for v in receipts.values())} ورقة)")
    print(f"   فئات: {'، '.join(sorted(kinds))}\n")

    db = SessionLocal()
    made: dict[str, int] = defaultdict(int)
    unresolved: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    try:
        if branch_name:
            branch = db.scalars(select(Branch).where(Branch.name == branch_name)).first()
            if branch is None:
                raise SystemExit("مافيش فرع اسمه " + branch_name)
        else:
            branch = db.scalars(select(Branch).where(Branch.active.is_(True))
                                .order_by(Branch.id)).first()
        admin = db.scalars(select(User).order_by(User.id)).first()
        print("الفرع المستهدف: " + branch.name)

        by_code = {c.code: c for c in db.scalars(select(Customer)).all() if c.code}
        # المندوب عندنا مستخدم، وكود الموظف هو الجسر من رقم المندوب عندهم.
        user_by_emp = {e.code: e.user_id for e in db.scalars(select(Employee)).all()
                       if e.code and e.user_id}

        def customer(erp_id: str):
            row = trade.get(erp_id)
            return by_code.get(row[P_CODE]) if row and row[P_CODE] else None

        def rep_user(erp_rep: str) -> int | None:
            return user_by_emp.get(reps.get(erp_rep, ""))

        def miss(erp_id: str, papers: int) -> None:
            """ليه الطرف ده مالوش كارت — الفرق بين «الخريطة ساكتة» و«الكود مش عندنا»."""
            row = trade.get(erp_id)
            if row is None:
                why, who = "مش في خريطة الأطراف أصلاً", f"{erp_id}"
            elif not row[P_CODE]:
                why = "الخريطة مادّياله كود a5"
                who = f"{erp_id} — {row[P_NAME] or '(بلا اسم)'} [{row[P_TYPE]}]"
            else:
                why = "كود a5 مش موجود في كشف العملاء"
                who = f"{erp_id} — {row[P_NAME] or '(بلا اسم)'} → {row[P_CODE]}"
            unresolved[why][who] += papers

        # المطابقة بتتقاس قبل أي كتابة، فالعرض والتنفيذ بيقولوا نفس الأرقام.
        for key, group in issues.items():
            made["أوراق صرف بعميل" if customer(key[0]) else "أوراق صرف بغير عميل"] \
                += len(group)
            if customer(key[0]) is None:
                miss(key[0], len(group))
        for group in receipts.values():
            erp_plumb = group[0][C_PLUMB]
            made["أوراق استلام بعميل" if customer(erp_plumb)
                 else "أوراق استلام بغير عميل"] += len(group)
            if customer(erp_plumb) is None:
                miss(erp_plumb, len(group))

        if not execute:
            print()
            for k, v in sorted(made.items()):
                print(f"{k:<26}{v:>8}")
            _show_unresolved(unresolved)
            print("\nعرض فقط — مافيش حاجة اتكتبت. أضف --yes للتنفيذ.")
            return

        added = _ensure_kinds(db, kinds)
        if added:
            print("فئات اتزادت للقايمة: " + "، ".join(added))
        print()

        done_issue = {r for (r,) in db.execute(
            select(CouponIssue.external_ref).where(
                CouponIssue.external_ref.is_not(None))).all()}
        taken_receipt = {n for (n,) in db.execute(
            select(CouponReceipt.document_number)).all()}
        # الورقة بتخرج مرة وبترجع مرة — القيد على (الفئة، الرقم) بيمنع التكرار، والفحص
        # هنا بيمنع الانفجار قبل ما يوصل للقاعدة.
        received = {(ln.coupon_kind, ln.serial) for ln in
                    db.scalars(select(CouponReceiptLine)).all()}
        issued = {(ln.coupon_kind, ln.serial) for ln in
                  db.scalars(select(CouponIssueLine)).all()}

        # ---------- الصرف ----------
        for (dist_id, day, kind, rep_id), group in sorted(issues.items()):
            ref = f"erp:issue:{dist_id}:{day}:{kind}:{rep_id}"
            if ref in done_issue:
                continue
            fresh = [(kind, _split(g[C_SERIAL])[1]) for g in group]
            fresh = [(k, s) for k, s in fresh if (k, s) not in issued]
            if not fresh:
                continue
            owner = customer(dist_id)
            note = _one({_note(g[C_NOTES], kind) for g in group}) or None
            issue = CouponIssue(
                # رقم المستند من أصغر `DetailId` في المجموعة — ثابت ومالوش تكرار،
                # وبيرجّع أي سطر عندنا لصفه في نظامهم.
                document_number=f"CI-ERP-{min(int(g[C_ID]) for g in group)}"[:24],
                branch_id=branch.id, customer_id=owner.id if owner else None,
                coupon_kind=kind or None, issue_date=_date(day),
                count=len(fresh), unit_value=None, notes=note,
                external_ref=ref, rep_user_id=rep_user(rep_id),
                actor_user_id=admin.id if admin else None)
            db.add(issue)
            db.flush()
            for k, s in fresh:
                db.add(CouponIssueLine(issue_id=issue.id, serial=s, coupon_kind=k))
                issued.add((k, s))
            done_issue.add(ref)
            made["مستندات صرف"] += 1
            made["أوراق اتصرفت"] += len(fresh)
            if owner is None:
                made["صرف بغير عميل"] += 1

        db.flush()
        issue_by_key = {(ln.coupon_kind, ln.serial): ln.issue_id
                        for ln in db.scalars(select(CouponIssueLine)).all()}

        # ---------- الاستلام ----------
        for code, group in sorted(receipts.items(), key=lambda kv: int(kv[0])):
            number = f"CR-ERP-{code}"[:24]
            if number in taken_receipt:
                continue
            fresh = [(_split(g[C_SERIAL])[0], _split(g[C_SERIAL])[1]) for g in group]
            fresh = [(k, s) for k, s in fresh if (k, s) not in received]
            if not fresh:
                continue
            erp_plumb = group[0][C_PLUMB]
            row = trade.get(erp_plumb)
            taker = customer(erp_plumb)
            # اسم اللي سلّم بيتكتب على المستند حتى لو مالوش كارت — الورقة اتسلّمت من
            # راجل بعينه، وسطر من غير اسم بيخلّي المستند بلا صاحب.
            who = "" if taker is not None else (
                f"سلّمها: {row[P_NAME]} (كود {erp_plumb})" if row and row[P_NAME]
                else f"سلّمها: كود {erp_plumb}")
            note = _one({_note(g[C_NOTES], _split(g[C_SERIAL])[0]) for g in group})
            receipt = CouponReceipt(
                document_number=number, branch_id=branch.id,
                customer_id=taker.id if taker else None,
                customer_type=(row[P_TYPE] if row else None),
                rep_user_id=rep_user(group[0][C_REP_R]),
                received_date=_date(group[0][C_RECV]),
                coupon_count=len(fresh),
                declared_kind=_one({k for k, _s in fresh}),
                declared_value=_money(_one({g[C_VALUE] for g in group}) or ""),
                notes="؛ ".join(x for x in (who, note) if x)[:500] or None,
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
        print(f"{'الكيان':<26}{'عدد':>8}")
        print("-" * 34)
        for k, v in sorted(made.items()):
            print(f"{k:<26}{v:>8}")
        _show_unresolved(unresolved)
        print("\nتم.")
    finally:
        db.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    folder = args[args.index("--dir") + 1] if "--dir" in args else "C:/pgtmp/erp"
    target = args[args.index("--branch") + 1] if "--branch" in args else ""
    run(folder, execute="--yes" in args, branch_name=target)
