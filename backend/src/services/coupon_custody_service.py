"""عهدة الكوبونات — مين ماسك أنهي ورقة، وإمتى يقدر يدّيها لعميل.

العميل طلبها زي عهدة البضاعة: «أدّي المندوب ٥٠ فضي و٥٠ ذهبي، من سريال كذا لسريال كذا».
والقاعدة اللي بتيجي معاها: **المندوب مايدّيش عميل ورقة مش في عهدته**. قبل كده الفاتورة
كانت بتقبل أي أرقام تتكتب، والرقم ده بيرجع بعدين من السباك على إنه «متصرّف من النظام»
— والنظام عمره ما سأل الورقة دي خرجت من المكتب ولا لأ.

## القفل على مين (قرارات العميل)

١. **القفل على المندوب اللي ليه عهدة من الفئة دي بس** — أي مستند صرف في أي وقت للمندوب
   ده بالفئة دي. المندوب اللي مالوش عهدة بيفضل شغّال زي النهارده. من غير كده يوم التشغيل
   كل مندوب بيقف لحد ما المكتب يسجّل دفاتره كلها.
٢. **فاتورة المكتب** — لو عليها مندوب، السريالات من عهدته هو (بنفس شرط ١). من غير مندوب
   حرة زي النهارده، **بس** ماتاخدش ورقة في عهدة أي مندوب — دي ورقة المكتب سلّمها خلاص.
٣. **استلام الكوبونات من السباك** — الورقة اللي لسه مع المندوب (ماتصرفتش لعميل) بتترفض
   برسالة صريحة: السباك مايقدرش يكون ماسك ورقة لسه في شنطة المندوب.

## الصرف على الفاتورة

الفاتورة بتاخد ورقها من العهدة وقت الحفظ (`consume_for_invoice`) وبترجّعه وقت التعديل أو
الحذف (`release_for_invoice`، من `purge_sale`). التعديل بيتبني من الأول زي أي حاجة تانية
في الفاتورة: الورق بيرجع العهدة، والبناء الجديد بياخده تاني — فتغيير النطاق أو المندوب
بيتحسب صح من غير منطق مخصوص للتعديل.

## الأرقام

العهدة **أرقام بس** — نطاق «من-إلى» لازم يبقى أرقام عشان يتفك لورق. الرقم بيتخزّن بصورته
الرقمية (`str(int)`) زي ما `coupon_receipt_service._as_int` بيقارن: «1001» على الفاتورة
و«1001» في العهدة نفس الورقة. والفئة بتتقارن بالصورة الموحّدة (`_norm_kind`) — «ذهبى»
المستوردة هي «ذهبي» اللي في القائمة.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.orm import Session

from src.auth.branch_scope import branch_for
from src.core import clock
from src.models.coupon_custody import CouponCustody, CouponCustodySerial
from src.models.coupon_issue import CouponIssue, CouponIssueLine
from src.models.coupon_receipt import CouponReceiptLine
from src.models.role import Role, RoleName
from src.models.sales import SalesInvoice, SalesInvoiceCoupon
from src.models.user import User
from src.services import audit_service, numbering
from src.services.coupon_receipt_service import _as_int, _norm_kind

# أكبر مستند عهدة. دفتر الورق ٥٠ أو ١٠٠، والمكتب ممكن يسلّم كرتونة — بس نطاق بمليون
# ورقة غلطة كتابة (صفر زيادة)، ولو عدّى بيكتب مليون صف ويقفل القاعدة دقايق.
MAX_PER_DOC = 5000

OUT, IN = "out", "in"
WITH_REP, GIVEN, RETURNED = "with_rep", "given", "returned"

# `IN (...)` بيتقسم على دفعات — بوستجرس بيستحمل أكتر، بس الـsqlite المحلي حده ٩٩٩ متغيّر.
_CHUNK = 900

# مفتاح في `Session.info` — شكل كوبونات الفاتورة قبل التعديل. شوف `release_for_invoice`.
_PRIOR_KEY = "coupon_custody_prior_rows"


class CouponCustodyError(Exception):
    """العهدة مش هتسمح بالحركة دي — والرسالة بتقول ليه بالأرقام."""


# ---------------------------------------------------------------- أدوات صغيرة

def compress(numbers: Iterable[int]) -> list[tuple[int, int]]:
    """[1001, 1002, 1003, 1010] ⇒ [(1001, 1003), (1010, 1010)]."""
    out: list[tuple[int, int]] = []
    for n in sorted(set(numbers)):
        if out and n == out[-1][1] + 1:
            out[-1] = (out[-1][0], n)
        else:
            out.append((n, n))
    return out


def _ranges_text(numbers: Iterable[int], limit: int = 6) -> str:
    """«1051–1053، 1060» — الأرقام مضغوطة عشان الرسالة تتقري مش تتعد.

    `–` بين رقمين بتتقلب في النص العربي لو اتكتبت «من-إلى» بالشرطة العادية، فالشرطة
    الطويلة أوضح. وبعد ست نطاقات بنقول «و… كمان» بدل رسالة بطول الشاشة.
    """
    parts = compress(numbers)
    shown = [f"{a}–{b}" if a != b else f"{a}" for a, b in parts[:limit]]
    text = "، ".join(shown)
    if len(parts) > limit:
        text += f" و{len(parts) - limit} نطاق كمان"
    return text


def _label(numbers: Iterable[int], kind: str) -> str:
    nums = list(numbers)
    word = "السريال" if len(set(nums)) == 1 else "السريالات"
    return f"{word} {_ranges_text(nums)} ({kind})"


_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def ascii_digits(value) -> str:
    """«١٠٠١» ⇒ «1001». الكيبورد العربي بيكتب أرقام هندية، والورقة هي هي.

    `_as_int` بيرفض «١٠٠١» (لأن `str(int("١٠٠١"))` بترجع «1001» مش نفس النص)، فمن غير
    التحويل ده رقم مكتوب بالعربي كان هيبقى «مش أرقام» وهو أرقام.
    """
    return str(value or "").strip().translate(_DIGITS)


def _chunks(values: list, size: int = _CHUNK):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _rep_names(db: Session, ids: Iterable[int]) -> dict[int, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {uid: (name or username) for uid, name, username in db.execute(
        select(User.id, User.full_name, User.username).where(User.id.in_(wanted)))}


def rep_name(db: Session, rep_user_id: int | None) -> str:
    if not rep_user_id:
        return "—"
    return _rep_names(db, [rep_user_id]).get(rep_user_id, f"مندوب #{rep_user_id}")


def _as_rep(name: str) -> str:
    """«المندوب أحمد» — بس اللي اسمه أصلاً «مندوب السياره (أ)» مايبقاش «المندوب مندوب…»."""
    return name if name.strip().startswith("مندوب") else f"المندوب {name}"


def parse_range(serial_from, serial_to) -> tuple[int, int]:
    """النطاق كأرقام، أو رفض برسالة. رقم واحد (من غير «إلى») = ورقة واحدة."""
    raw_from = ascii_digits(serial_from)
    raw_to = ascii_digits(serial_to) or raw_from
    if not raw_from:
        raise CouponCustodyError("اكتب السريال «من».")
    first, last = _as_int(raw_from), _as_int(raw_to)
    if first is None or last is None or first < 0 or last < 0:
        raise CouponCustodyError(
            f"السريالات لازم تكون أرقام صحيحة من غير حروف ولا أصفار على الشمال "
            f"(«{raw_from}» – «{raw_to}»).")
    if last < first:
        raise CouponCustodyError("رقم النهاية أصغر من رقم البداية.")
    if last - first + 1 > MAX_PER_DOC:
        raise CouponCustodyError(
            f"النطاق كبير جداً ({last - first + 1} ورقة) — أقصى {MAX_PER_DOC} "
            "في المستند الواحد. قسّمه على أكتر من مستند.")
    return first, last


def stored_kind(db: Session, kind: str | None) -> str | None:
    """إملا الفئة زي ما هي متسجّلة في العهدة، أو None لو الفئة دي مالهاش عهدة خالص.

    المستند الأول بيثبّت الإملا، والباقي بيتقاس عليه بالصورة الموحّدة. من غير كده «ذهبى»
    و«ذهبي» يبقوا عهدتين، والقيد الفريد على (الفئة، الرقم) مايمسكش نفس الورقة مرتين.
    """
    key = _norm_kind(kind)
    if not key:
        return None
    for (existing,) in db.execute(select(CouponCustody.coupon_kind).distinct()):
        if _norm_kind(existing) == key:
            return existing
    return None


def _canonical_kind(db: Session, kind: str | None) -> str:
    text = " ".join(str(kind or "").split())
    if not text:
        raise CouponCustodyError("اختار فئة الكوبون.")
    return stored_kind(db, text) or text


def custody_kinds(db: Session, rep_user_id: int | None) -> list[str]:
    """الفئات اللي المندوب ده ليه فيها مستند صرف — دي اللي القفل بيتطبّق عليها (قرار ١)."""
    if not rep_user_id:
        return []
    return sorted(db.scalars(
        select(CouponCustody.coupon_kind).distinct().where(
            CouponCustody.rep_user_id == rep_user_id, CouponCustody.direction == OUT)).all())


def _rows_for(db: Session, kind: str, serials: list[str]) -> dict[str, CouponCustodySerial]:
    found: dict[str, CouponCustodySerial] = {}
    for part in _chunks(serials):
        for row in db.scalars(select(CouponCustodySerial).where(
                CouponCustodySerial.coupon_kind == kind,
                CouponCustodySerial.serial.in_(part))):
            found[row.serial] = row
    return found


def _require_rep(db: Session, rep_user_id: int | None) -> User:
    if not rep_user_id:
        raise CouponCustodyError("اختار المندوب.")
    rep = db.scalar(select(User).join(Role, Role.id == User.role_id).where(
        User.id == rep_user_id, Role.name == RoleName.sales_rep))
    if rep is None:
        raise CouponCustodyError("المستخدم ده مش مندوب.")
    return rep


def _handed_elsewhere(db: Session, kind: str, first: int, last: int,
                      skip: set[int]) -> dict[str, list[int]]:
    """أرقام النطاق اللي اتصرفت بالفعل على فاتورة أو مستند صرف — بنفس الفئة.

    الورقة اللي في إيد عميل ماتدخلش عهدة حد: لو دخلت، المندوب يدّيها لعميل تاني
    والسباكين الاتنين يرجّعوها. الفواتير اللي فئتها فاضية مابتتحسبش هنا — كل دفتر مرقّم
    ١..٥٠ فرقم من غير فئة هيقفل الأرقام دي في كل الفئات.
    """
    key = _norm_kind(kind)
    hits: dict[str, list[int]] = {}
    inv_ids: dict[int, list[int]] = {}
    for invoice_id, row_kind, s_from, s_to in db.execute(
            select(SalesInvoiceCoupon.invoice_id, SalesInvoiceCoupon.coupon_kind,
                   SalesInvoiceCoupon.serial_from, SalesInvoiceCoupon.serial_to)
            .where(SalesInvoiceCoupon.coupon_kind.isnot(None),
                   (SalesInvoiceCoupon.serial_from.isnot(None))
                   | (SalesInvoiceCoupon.serial_to.isnot(None)))):
        if _norm_kind(row_kind) != key:
            continue
        a = _as_int(ascii_digits(s_from if s_from else s_to))
        b = _as_int(ascii_digits(s_to if s_to else s_from))
        if a is None or b is None or b < first or a > last:
            continue
        nums = [n for n in range(max(a, first), min(b, last) + 1) if n not in skip]
        if nums:
            inv_ids.setdefault(invoice_id, []).extend(nums)
    if inv_ids:
        docs = dict(db.execute(select(SalesInvoice.id, SalesInvoice.document_number)
                               .where(SalesInvoice.id.in_(list(inv_ids)))).all())
        for iid, nums in inv_ids.items():
            hits.setdefault(docs.get(iid, f"فاتورة #{iid}"), []).extend(nums)

    serials = [str(n) for n in range(first, last + 1) if n not in skip]
    issue_ids: dict[int, list[int]] = {}
    for part in _chunks(serials):
        for serial, line_kind, issue_id in db.execute(
                select(CouponIssueLine.serial, CouponIssueLine.coupon_kind,
                       CouponIssueLine.issue_id)
                .where(CouponIssueLine.serial.in_(part),
                       CouponIssueLine.coupon_kind.isnot(None))):
            if _norm_kind(line_kind) == key:
                issue_ids.setdefault(issue_id, []).append(int(serial))
    if issue_ids:
        docs = dict(db.execute(select(CouponIssue.id, CouponIssue.document_number)
                               .where(CouponIssue.id.in_(list(issue_ids)))).all())
        for iid, nums in issue_ids.items():
            hits.setdefault(docs.get(iid, f"صرف #{iid}"), []).extend(nums)
    return hits


def _doc_number(db: Session) -> str:
    return numbering.next_document_number(db, CouponCustody, "CC")


# ---------------------------------------------------------------- صرف واسترجاع

def issue(db: Session, *, rep_user_id: int, coupon_kind: str, serial_from, serial_to,
          actor_user_id: int, doc_date: date | None = None,
          notes: str | None = None) -> CouponCustody:
    """صرف عهدة كوبونات لمندوب — كل الورق أو ولا ورقة.

    بيترفض لو أي ورقة في النطاق: في عهدة حد (نفس المندوب أو غيره)، أو اتصرفت لعميل من
    العهدة، أو اتصرفت على فاتورة أو مستند صرف قبل العهدة أصلاً. الورقة اللي **رجعت**
    المكتب بتتصرف تاني عادي — لنفس المندوب أو لغيره.
    """
    _require_rep(db, rep_user_id)
    kind = _canonical_kind(db, coupon_kind)
    first, last = parse_range(serial_from, serial_to)
    serials = [str(n) for n in range(first, last + 1)]
    rows = _rows_for(db, kind, serials)

    held: dict[int, list[int]] = {}
    given: list[int] = []
    for serial, row in rows.items():
        if row.status == WITH_REP:
            held.setdefault(row.rep_user_id, []).append(int(serial))
        elif row.status == GIVEN:
            given.append(int(serial))

    problems: list[str] = []
    names = _rep_names(db, held)
    for rid, nums in held.items():
        who = "نفس المندوب" if rid == rep_user_id else names.get(rid, f"مندوب #{rid}")
        problems.append(f"{_label(nums, kind)} في عهدة {who} بالفعل")
    if given:
        problems.append(f"{_label(given, kind)} اتصرفت لعملاء قبل كده")
    skip = {int(s) for s in rows}
    for doc, nums in list(_handed_elsewhere(db, kind, first, last, skip).items())[:4]:
        problems.append(f"{_label(nums, kind)} متصرّفة على {doc}")
    if problems:
        raise CouponCustodyError("ماينفعش تتصرف: " + "؛ ".join(problems))

    doc = CouponCustody(
        document_number=_doc_number(db), direction=OUT, rep_user_id=rep_user_id,
        coupon_kind=kind, serial_from=str(first), serial_to=str(last),
        count=len(serials), doc_date=doc_date or clock.today(),
        notes=(notes or None),
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind="rep", location_id=rep_user_id),
        actor_user_id=actor_user_id,
    )
    db.add(doc)
    db.flush()
    # الورق اللي رجع قبل كده ليه صف — بيتعدّل. والجديد بيتكتب دفعة واحدة: ٥٠٠٠ صف واحد
    # واحد من الـORM بياخدوا ثواني.
    for row in rows.values():
        row.rep_user_id = rep_user_id
        row.status = WITH_REP
        row.custody_id = doc.id
        row.return_id = None
        row.given_invoice_id = None
        row.given_issue_id = None
    fresh = [{"coupon_kind": kind, "serial": s, "rep_user_id": rep_user_id,
              "status": WITH_REP, "custody_id": doc.id}
             for s in serials if s not in rows]
    if fresh:
        db.execute(insert(CouponCustodySerial), fresh)
    db.flush()
    audit_service.record(
        db, action="coupon_custody.issue", actor_user_id=actor_user_id,
        entity_type="coupon_custody", entity_id=doc.id,
        after={"doc": doc.document_number, "rep_user_id": rep_user_id, "kind": kind,
               "from": doc.serial_from, "to": doc.serial_to, "count": doc.count},
    )
    return doc


def return_(db: Session, *, rep_user_id: int, coupon_kind: str, serial_from, serial_to,
            actor_user_id: int, doc_date: date | None = None,
            notes: str | None = None) -> CouponCustody:
    """استرجاع ورق من المندوب للمكتب — كل ورقة لازم تكون معاه هو ولسه ماتصرفتش."""
    _require_rep(db, rep_user_id)
    kind = stored_kind(db, coupon_kind)
    if kind is None:
        raise CouponCustodyError(f"الفئة «{coupon_kind or '—'}» مالهاش عهدة عند أي مندوب.")
    first, last = parse_range(serial_from, serial_to)
    serials = [str(n) for n in range(first, last + 1)]
    rows = _rows_for(db, kind, serials)

    missing: list[int] = []
    back_already: list[int] = []
    given: list[int] = []
    other: dict[int, list[int]] = {}
    mine: list[CouponCustodySerial] = []
    for s in serials:
        row = rows.get(s)
        if row is None:
            missing.append(int(s))
        elif row.status == RETURNED:
            back_already.append(int(s))
        elif row.status == GIVEN:
            given.append(int(s))
        elif row.rep_user_id != rep_user_id:
            other.setdefault(row.rep_user_id, []).append(int(s))
        else:
            mine.append(row)

    problems: list[str] = []
    if missing:
        problems.append(f"{_label(missing, kind)} مش متسجّلة في أي عهدة")
    if back_already:
        problems.append(f"{_label(back_already, kind)} رجعت المكتب قبل كده")
    if given:
        problems.append(f"{_label(given, kind)} اتصرفت لعملاء — مابترجعش")
    names = _rep_names(db, other)
    for rid, nums in other.items():
        problems.append(f"{_label(nums, kind)} في عهدة {names.get(rid, f'مندوب #{rid}')} "
                        "مش المندوب ده")
    if problems:
        raise CouponCustodyError("ماينفعش ترجع: " + "؛ ".join(problems))

    doc = CouponCustody(
        document_number=_doc_number(db), direction=IN, rep_user_id=rep_user_id,
        coupon_kind=kind, serial_from=str(first), serial_to=str(last),
        count=len(serials), doc_date=doc_date or clock.today(),
        notes=(notes or None),
        branch_id=branch_for(db, actor_user_id=actor_user_id,
                             location_kind="rep", location_id=rep_user_id),
        actor_user_id=actor_user_id,
    )
    db.add(doc)
    db.flush()
    for row in mine:
        row.status = RETURNED
        row.return_id = doc.id
    db.flush()
    audit_service.record(
        db, action="coupon_custody.return", actor_user_id=actor_user_id,
        entity_type="coupon_custody", entity_id=doc.id,
        after={"doc": doc.document_number, "rep_user_id": rep_user_id, "kind": kind,
               "from": doc.serial_from, "to": doc.serial_to, "count": doc.count},
    )
    return doc


def delete_doc(db: Session, *, custody_id: int, actor_user_id: int) -> str:
    """يمسح مستند عهدة **لو ورقه ماتحرّكش** — وإلا المسح بيكدب على اللي حصل بعده.

    صرف: كل ورقه لسه مع نفس المندوب ومحدش لمسه بعده (ماتصرفش لعميل، ومارجعش، ومااتصرفش
    تاني بمستند أحدث). المسح بيشيل الورق من العهدة خالص، فيتصرف تاني عادي.
    استرجاع: كل ورقه لسه راجع ومااتصرفش تاني — والمسح بيرجّعه لعهدة المندوب.
    """
    doc = db.get(CouponCustody, custody_id)
    if doc is None:
        raise CouponCustodyError("مستند العهدة ده مش موجود.")
    if doc.direction == OUT:
        rows = db.scalars(select(CouponCustodySerial).where(
            CouponCustodySerial.custody_id == doc.id)).all()
        moved = (doc.count - len(rows)) + sum(
            1 for r in rows if r.status != WITH_REP or r.rep_user_id != doc.rep_user_id)
        if moved:
            raise CouponCustodyError(
                f"المستند {doc.document_number} ماينفعش يتمسح — {moved} ورقة منه اتحرّكت "
                "(اتصرفت لعميل، أو رجعت، أو اتصرفت تاني). امسح الحركة دي الأول.")
        db.execute(delete(CouponCustodySerial).where(
            CouponCustodySerial.custody_id == doc.id))
    else:
        rows = db.scalars(select(CouponCustodySerial).where(
            CouponCustodySerial.return_id == doc.id)).all()
        moved = (doc.count - len(rows)) + sum(1 for r in rows if r.status != RETURNED)
        if moved:
            raise CouponCustodyError(
                f"المستند {doc.document_number} ماينفعش يتمسح — {moved} ورقة منه اتصرفت "
                "تاني بعد ما رجعت. امسح الصرف ده الأول.")
        for r in rows:
            r.status = WITH_REP
            r.return_id = None
    number = doc.document_number
    audit_service.record(
        db, action="coupon_custody.delete", actor_user_id=actor_user_id,
        entity_type="coupon_custody", entity_id=doc.id,
        before={"doc": number, "direction": doc.direction, "rep_user_id": doc.rep_user_id,
                "kind": doc.coupon_kind, "from": doc.serial_from, "to": doc.serial_to,
                "count": doc.count},
    )
    db.flush()
    db.delete(doc)
    db.flush()
    return number


# ---------------------------------------------------------------- الرصيد

def balance(db: Session, rep_user_id: int | None = None,
            rep_ids: Iterable[int] | None = None) -> list[dict]:
    """لكل مندوب × فئة: المتاح معاه (عدد ونطاقات)، واللي اتصرف لعملاء، واللي رجع.

    «رجع» من مستندات الاسترجاع مش من حالة الورقة: الورقة اللي رجعت واتصرفت تاني لمندوب
    تاني حالتها النهارده «معاه»، بس الاسترجاع الأول حصل فعلاً ولازم يتعد عند صاحبه.
    """
    doc_stmt = select(CouponCustody.rep_user_id, CouponCustody.coupon_kind,
                      CouponCustody.direction, func.sum(CouponCustody.count)) \
        .group_by(CouponCustody.rep_user_id, CouponCustody.coupon_kind,
                  CouponCustody.direction)
    row_stmt = select(CouponCustodySerial.rep_user_id, CouponCustodySerial.coupon_kind,
                      CouponCustodySerial.serial).where(
        CouponCustodySerial.status == WITH_REP)
    given_stmt = select(CouponCustodySerial.rep_user_id, CouponCustodySerial.coupon_kind,
                        func.count()).where(CouponCustodySerial.status == GIVEN) \
        .group_by(CouponCustodySerial.rep_user_id, CouponCustodySerial.coupon_kind)
    if rep_user_id:
        doc_stmt = doc_stmt.where(CouponCustody.rep_user_id == rep_user_id)
        row_stmt = row_stmt.where(CouponCustodySerial.rep_user_id == rep_user_id)
        given_stmt = given_stmt.where(CouponCustodySerial.rep_user_id == rep_user_id)
    elif rep_ids is not None:
        ids = list(rep_ids)
        if not ids:
            return []
        doc_stmt = doc_stmt.where(CouponCustody.rep_user_id.in_(ids))
        row_stmt = row_stmt.where(CouponCustodySerial.rep_user_id.in_(ids))
        given_stmt = given_stmt.where(CouponCustodySerial.rep_user_id.in_(ids))

    cells: dict[tuple[int, str], dict] = {}

    def cell(rid: int, kind: str) -> dict:
        return cells.setdefault((rid, kind), {
            "rep_user_id": rid, "coupon_kind": kind, "issued": 0, "returned": 0,
            "given": 0, "available": 0, "_nums": []})

    for rid, kind, direction, total in db.execute(doc_stmt):
        c = cell(rid, kind)
        c["issued" if direction == OUT else "returned"] += int(total or 0)
    for rid, kind, serial in db.execute(row_stmt):
        n = _as_int(serial)
        if n is not None:
            cell(rid, kind)["_nums"].append(n)
    for rid, kind, total in db.execute(given_stmt):
        cell(rid, kind)["given"] = int(total or 0)

    names = _rep_names(db, {rid for rid, _ in cells})
    out = []
    for (rid, _kind), c in cells.items():
        nums = c.pop("_nums")
        c["available"] = len(nums)
        c["ranges"] = [[str(a), str(b)] for a, b in compress(nums)]
        c["rep_name"] = names.get(rid, f"مندوب #{rid}")
        out.append(c)
    out.sort(key=lambda c: (c["rep_name"], c["coupon_kind"]))
    return out


def rep_bundle(db: Session, rep_user_id: int) -> tuple[list[dict], list[str]]:
    """اللي التطبيق محتاجه عشان يقفل على المندوب وهو من غير شبكة.

    (العهدة المتاحة معاه — فئة ونطاقات وعدد، والفئات اللي عليها قفل حتى لو خلصت). الفئة
    اللي خلص ورقها لسه مقفولة: المندوب مايكتبش فيها أرقام من دماغه لمجرد إن العهدة فضيت.
    """
    kinds = custody_kinds(db, rep_user_id)
    rows = balance(db, rep_user_id=rep_user_id)
    custody = [{"kind": r["coupon_kind"], "ranges": r["ranges"], "count": r["available"]}
               for r in rows if r["available"]]
    return custody, kinds


# ---------------------------------------------------------------- الفاتورة

def _row_key(kind, serial_from, serial_to) -> tuple[str, str, str]:
    return (_norm_kind(kind), ascii_digits(serial_from), ascii_digits(serial_to))


def release_for_invoice(db: Session, invoice: SalesInvoice) -> None:
    """الورق اللي الفاتورة دي صرفته يرجع عهدة المندوب — قبل تعديلها أو حذفها.

    بيتنادى من `purge_sale`، فالتعديل والحذف الاتنين بيعدّوا عليه من غير ما حد يفتكره.

    وبيحفظ شكل كوبونات الفاتورة **قبل** ما التفضية تمسحها، في `Session.info`. السبب: فاتورة
    اتكتبت قبل ما المندوب ياخد عهدة، وأرقامها مش في العهدة. تصليح سعر فيها بعد كده كان
    هيترفض «السريالات مش في عهدة المندوب» مع إن محدش لمس الكوبونات. فالصف اللي رجع زي ما
    كان بالظبط بيعدّي — والجديد أو المتغيّر بيتقفل عادي.
    """
    prior = {_row_key(r.coupon_kind, r.serial_from, r.serial_to)
             for r in db.scalars(select(SalesInvoiceCoupon).where(
                 SalesInvoiceCoupon.invoice_id == invoice.id))}
    if invoice.coupon_serial_from or invoice.coupon_serial_to:
        prior.add(_row_key(None, invoice.coupon_serial_from, invoice.coupon_serial_to))
    db.info.setdefault(_PRIOR_KEY, {})[invoice.id] = prior
    db.execute(update(CouponCustodySerial)
               .where(CouponCustodySerial.given_invoice_id == invoice.id)
               .values(status=WITH_REP, given_invoice_id=None))
    db.flush()


def consume_for_invoice(db: Session, invoice: SalesInvoice, rep_user_id: int | None,
                        coupon_rows: Iterable) -> None:
    """الورق اللي على الفاتورة بيتصرف من العهدة — أو الفاتورة كلها بتترفض.

    `coupon_rows` أي حاجة فيها `coupon_kind`/`count`/`serial_from`/`serial_to` (صفوف الجسم
    أو صفوف الجدول). القواعد في أول الملف؛ باختصار:

    * المندوب ليه عهدة من الفئة ⇒ كل ورقة لازم تكون معاه دلوقتي، والصف اللي فيه عدد من
      غير أرقام بيترفض (العدد لوحده مايقولش أنهي ورق).
    * غير كده ⇒ حر، بس الورقة اللي في عهدة مندوب ماتتصرفش من غيره، واللي اتصرفت من
      العهدة على فاتورة تانية ماتتصرفش تاني.
    """
    prior = db.info.get(_PRIOR_KEY, {}).pop(invoice.id, set())
    enforced = {_norm_kind(k): k for k in custody_kinds(db, rep_user_id)}
    problems: list[str] = []
    seen: dict[str, set[int]] = {}
    to_give: list[CouponCustodySerial] = []
    rep_label = rep_name(db, rep_user_id) if rep_user_id else None

    for row in coupon_rows:
        kind = " ".join(str(getattr(row, "coupon_kind", None) or "").split())
        s_from = ascii_digits(getattr(row, "serial_from", None))
        s_to = ascii_digits(getattr(row, "serial_to", None))
        count = getattr(row, "count", None)
        if not kind and not s_from and not s_to and not count:
            continue
        grandfathered = _row_key(kind, s_from, s_to) in prior
        if not kind:
            # من غير فئة الرقم مش هوية — «٥» ممكن تبقى ذهبي أو فضي، فمافيش عهدة نقيس عليها.
            # والتطبيق مابيفحصش الصف اللي فئته فاضية، فالسيرفر هو اللي بيمسكه: المندوب اللي
            # عليه عهدة من أي فئة لازم يختار الفئة. اللي مالوش عهدة خالص زي النهارده.
            if enforced and not grandfathered:
                problems.append("اختار فئة الكوبون — المندوب عليه عهدة كوبونات")
            continue
        key = _norm_kind(kind)
        locked = enforced.get(key)
        if not s_from and not s_to:
            if locked and count and not grandfathered:
                problems.append(f"اكتب السريالات من-إلى — الفئة دي عليها عهدة ({kind})")
            continue
        first = _as_int(s_from or s_to)
        last = _as_int(s_to or s_from)
        if (first is None or last is None or first < 0 or last < first
                or last - first + 1 > MAX_PER_DOC):
            # نطاق مش أرقام مايقعش في العهدة (العهدة أرقام بس). على فئة مقفولة ده رفض؛
            # على فئة حرة بيعدّي زي النهارده.
            if locked and not grandfathered:
                problems.append(
                    f"سريالات «{kind}» لازم تكون أرقام من-إلى (النهاية مش أصغر من البداية، "
                    f"وأقصى {MAX_PER_DOC}) — الفئة دي عليها عهدة")
            continue
        nums = list(range(first, last + 1))
        dup = seen.setdefault(key, set()).intersection(nums)
        if dup:
            problems.append(f"{_label(dup, kind)} مكرّرة في الفاتورة")
        seen[key].update(nums)

        store_kind = locked or stored_kind(db, kind)
        if store_kind is None:
            continue  # الفئة دي مالهاش عهدة عند أي حد — حرة.
        rows = _rows_for(db, store_kind, [str(n) for n in nums])
        not_held: list[int] = []
        given_by: dict[int | None, list[int]] = {}
        held_by: dict[int, list[int]] = {}
        for n in nums:
            r = rows.get(str(n))
            if r is None or r.status == RETURNED:
                if locked and not (grandfathered and r is None):
                    not_held.append(n)
            elif r.status == GIVEN:
                given_by.setdefault(r.given_invoice_id, []).append(n)
            elif locked and r.rep_user_id == rep_user_id:
                to_give.append(r)
            else:
                held_by.setdefault(r.rep_user_id, []).append(n)

        if not_held:
            problems.append(f"{_label(not_held, kind)} مش في عهدة {_as_rep(rep_label)}")
        if given_by:
            invoice_ids = [i for i in given_by if i]
            docs = dict(db.execute(
                select(SalesInvoice.id, SalesInvoice.document_number)
                .where(SalesInvoice.id.in_(invoice_ids))).all()) if invoice_ids else {}
            for iid, ns in given_by.items():
                where = docs.get(iid) if iid else None
                problems.append(f"{_label(ns, kind)} اتصرفت قبل كده"
                                + (f" على {where}" if where else ""))
        names = _rep_names(db, held_by)
        for rid, ns in held_by.items():
            who = names.get(rid, f"مندوب #{rid}")
            if locked:
                problems.append(f"{_label(ns, kind)} في عهدة {who} مش {_as_rep(rep_label)}")
            else:
                problems.append(f"{_label(ns, kind)} في عهدة {_as_rep(who)} — "
                                "ماتتصرفش إلا على فاتورة باسمه")

    if problems:
        raise CouponCustodyError("؛ ".join(problems))
    for r in to_give:
        r.status = GIVEN
        r.given_invoice_id = invoice.id
    db.flush()


def assert_received_kept(db: Session, invoice: SalesInvoice) -> None:
    """بعد تعديل الفاتورة: الورقة اللي السباك رجّعها على الفاتورة دي لازم تفضل عليها.

    التعديل بيرجّع الورق للعهدة وبيعيد صرفه. لو التعديل شال ورقة كانت اتستلمت من سباك،
    الورقة تبقى «مع المندوب» وفي نفس الوقت «راجعة من السباك» — والمندوب يدّيها لعميل تاني
    والاستلام التاني يترفض «اتستلمت قبل كده». فالتعديل ده بيترفض بدل ما يسيب الحالة دي.
    """
    # السطر اللي مالوش فئة جه من تسجيل قديم من غير فئة، والعهدة مابتعرفش الورق ده أصلاً.
    lines = db.execute(select(CouponReceiptLine.serial, CouponReceiptLine.coupon_kind)
                       .where(CouponReceiptLine.sales_invoice_id == invoice.id,
                              CouponReceiptLine.coupon_kind.isnot(None))).all()
    if not lines:
        return
    wanted = {(s, _norm_kind(k)) for s, k in lines}
    serials = sorted({s for s, _ in lines})
    back: dict[str, list[int]] = {}
    for part in _chunks(serials):
        for row in db.scalars(select(CouponCustodySerial).where(
                CouponCustodySerial.serial.in_(part),
                CouponCustodySerial.status == WITH_REP)):
            n = _as_int(row.serial)
            if (row.serial, _norm_kind(row.coupon_kind)) in wanted and n is not None:
                back.setdefault(row.coupon_kind, []).append(n)
    if back:
        raise CouponCustodyError("؛ ".join(
            f"{_label(nums, kind)} اتستلمت من سباك على الفاتورة دي — ماينفعش تتشال منها"
            for kind, nums in back.items()))


# ---------------------------------------------------------------- الاستلام من السباك

def held_serials(db: Session, serials: list[str], coupon_kind: str | None) -> dict[str, int]:
    """الأرقام دي اللي لسه في عهدة مندوب (ماتصرفتش لعميل) ⇒ {السريال: المندوب}.

    من غير فئة مابنحكمش: كل دفتر مرقّم ١..٥٠، و«٥» فضي في شنطة المندوب مايقولش حاجة عن
    «٥» ذهبي في إيد السباك.
    """
    kind = stored_kind(db, coupon_kind)
    if kind is None:
        return {}
    # السريال المخزّن في العهدة أرقام إنجليزي؛ الاستلام بيتقارن بيه بعد التحويل، والمفتاح
    # الراجع هو النص زي ما اتبعت عشان رسالة الرفض تتكلم بنفس اللي اتكتب.
    asked = {ascii_digits(s): str(s).strip() for s in serials if str(s).strip()}
    wanted = list(asked)
    out: dict[str, int] = {}
    for part in _chunks(wanted):
        for row in db.scalars(select(CouponCustodySerial).where(
                CouponCustodySerial.coupon_kind == kind,
                CouponCustodySerial.serial.in_(part),
                CouponCustodySerial.status == WITH_REP)):
            out[asked.get(row.serial, row.serial)] = row.rep_user_id
    return out


def held_message(db: Session, held: dict[str, int], coupon_kind: str | None) -> str:
    by_rep: dict[int, list[int]] = {}
    for serial, rid in held.items():
        n = _as_int(ascii_digits(serial))
        if n is not None:
            by_rep.setdefault(rid, []).append(n)
    names = _rep_names(db, by_rep)
    kind = coupon_kind or "—"
    parts = [f"{_label(nums, kind)} في عهدة {names.get(rid, f'مندوب #{rid}')}"
             for rid, nums in by_rep.items()]
    return ("كوبونات لسه في عهدة المندوب ومااتصرفتش لعميل — السباك مايكونش ماسكها: "
            + "؛ ".join(parts))
