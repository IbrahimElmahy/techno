"""Ledger service (T017–T019): post_entry, reverse_entry, balance_of.

The only write paths into the ledger. No update/delete — corrections are reversals (FR-027/028).
All balances are derived here from `ledger_line` (FR-026); nothing is stored standalone.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import case, exists, func, select
from sqlalchemy.orm import Session

from src.core.money import ZERO, to_money
from src.models.journal import Journal
from src.models.ledger import (
    Account,
    Direction,
    EntryState,
    LedgerEntry,
    LedgerLine,
    MoveType,
    PartnerKind,
)
from src.services import journal_registry, lock_date_service, move_registry
from src.services.lock_date_service import LockDateError


class LedgerError(Exception):
    """Invalid ledger operation (unbalanced, too few lines, double reversal, ...)."""


@dataclass(frozen=True)
class LineInput:
    account_id: int
    direction: Direction
    amount: Decimal
    statement: str | None = None  # per-line بيان (005); ignored by 001/002/003 callers
    cost_center_id: int | None = None  # optional analytical dimension (006)
    # الشريك على السطر (المرحلة ٢). بيتساب `None` في الغالب وبيتورث من القيد؛ بيتحط
    # هنا في القيد اللي فيه أكتر من شريك — قيد الرواتب بيقيّد عشرين موظف مرة واحدة.
    partner_kind: PartnerKind | str | None = None
    partner_id: int | None = None
    # استحقاق السطر. `None` = يورث استحقاق القيد.
    date_maturity: date | None = None
    # توزيع تحليلي: `{cost_center_id: percent}` ومجموعه ١٠٠. لما يتحط، بيغلب
    # `cost_center_id` — السطر متقسّم، فمافيش مركز واحد يتكتب عليه.
    cost_center_distribution: dict | None = None


def _validate_lines(lines: list[LineInput]) -> None:
    """اللي فاضل من التحقق: سطر واحد على الأقل، وكل سطر بمبلغ موجب.

    كان فيه قاعدتين تانيين اتشالوا بطلب العميل — «سطرين على الأقل» و«مدين = دائن».
    الاتنين قواعد دفتر أستاذ: صح للنظام اللي بيتقفل بميزانية مدققة، وعائق للنظام اللي
    بيتكتب فيه قيد بسيط عشان يظبط رصيد. اللي كان بيكتب قيد بسطر واحد كان بيتقاله «القيد
    لازم يكون فيه سطرين»، فيخترع سطر تاني عشان يعدّي — والنتيجة قيد فيه سطر مالوش معنى
    بدل قيد ناقص بصراحة.

    الحاجتين اللي فاضلين مش قواعد محاسبية، دول شرط إن السطر يبقى ليه معنى أصلاً: قيد من
    غير سطور مش قيد، ومبلغ بصفر أو بالسالب مش مبلغ — والاتجاه (مدين/دائن) هو اللي بيحمل
    الإشارة.

    والمستندات اللي النظام بيكتبها بنفسه (بيع، شرا، سندات) بتطلع متوازنة بحكم بنائها،
    فمافيش حاجة فيها اتغيّرت.
    """
    if not lines:
        raise LedgerError("القيد لازم يكون فيه سطر واحد على الأقل.")
    if any(to_money(l.amount) <= ZERO for l in lines):
        raise LedgerError("كل سطر لازم يكون مبلغه أكبر من صفر.")


# --- «السطر ده داخل الحسابات ولا لأ» ------------------------------------------------------
#
# المسودة والملغي بيقعدوا في نفس الجدول زي أودو بالظبط، فكل حاجة بتحسب فلوس لازم
# تستثنيهم — الرصيد، الميزان، كشف الحساب، الأعمار، الإقرار الضريبي. الشرط مكتوب هنا
# مرة واحدة عشان المكان اللي هينساه يبان بالمقارنة، مش يتكشف من رصيد غلط.
#
# NULL = مرحّل: عمود `state` بيتضاف على جدول فيه ملايين السطور بـALTER TABLE، فبيبقى
# NULL في كل القديم لحد ما سكربت `backfill_journals` يعدّي. القديم كله كان مرحّل بحكم
# إن المسودة مالهاش وجود قبل المرحلة دي.


def posted_only(stmt):
    """يضيف شرط «قيده مرحّل» على استعلام بيوصل لـ`LedgerEntry` (join أو نفس الجدول)."""
    return stmt.where(is_posted_sql())


def is_posted_sql():
    """الشرط نفسه، لما الاستعلام محتاجه جوه `and_` أو `case`."""
    return LedgerEntry.state.is_(None) | (LedgerEntry.state == EntryState.posted.value)


def posted_line_cond():
    """نفس الشرط في صيغة EXISTS — للـLEFT JOIN.

    الاستعلامات اللي بتجيب «كل عميل ورصيده» بتعمل outer join على السطور عشان العميل
    اللي لسه ماتحركش يفضل في القايمة. لو ضفنا join تاني على القيد، الشرط بيتحوّل لـinner
    وبيرمي العملاء دول. فالشرط بيتحط في ON بتاع السطر نفسه بدل ما يبقى join زيادة.
    """
    return exists().where(
        (LedgerEntry.id == LedgerLine.entry_id) & is_posted_sql()
    )


def is_posted(entry: LedgerEntry) -> bool:
    """نفس الحكم في بايثون — للحلقات اللي بتلف على السطور بدل ما تستعلم."""
    return entry.state in (None, EntryState.posted.value)


def _sides(lines: list[LineInput]) -> tuple[Decimal, Decimal]:
    debit = sum((to_money(ln.amount) for ln in lines if ln.direction == Direction.debit), ZERO)
    credit = sum((to_money(ln.amount) for ln in lines if ln.direction == Direction.credit), ZERO)
    return to_money(debit), to_money(credit)


def _assert_balanced(lines: list[LineInput]) -> None:
    """المرحّل لازم يتوازن. المسودة معفية — دي نقطة المسودة أصلاً.

    القاعدة رجعت بعد ما كانت اتشالت، بس رجعت في مكان واحد بس: لحظة الترحيل. اللي كان
    بيتعرقل قبل كده هو اللي بيكتب قيد على مرّاحل ومحتاج يسيبه ناقص لحد ما يجيب الرقم
    الناقص — ده دلوقتي بيسيبه مسودة. واللي كان بيعدّي غلط هو ميزان مراجعة مش بيقفل
    على صفر، وده مافيش مبرر ليه.
    """
    debit, credit = _sides(lines)
    if debit != credit:
        diff = to_money(abs(debit - credit))
        raise LedgerError(
            f"القيد مش متوازن: المدين {debit} والدائن {credit} — الفرق {diff}. "
            "صلّح السطور أو سيبه مسودة."
        )


def _assert_period_open(
    db: Session, when: date | None, actor_user_id: int | None = None
) -> None:
    """إقفال الفترة — رجع في المرحلة ٤، والقرار كله في `lock_date_service`.

    كان اتشال بطلب العميل عشان الفاتورة اللي اتأخرت شهر تتكتب بتاريخها الحقيقي. رجع
    بتاريخين زي أودو، **والاتنين فاضيين** لحد ما الأدمن يحطهم — فالسلوك الافتراضي
    هو نفسه اللي العميل طلبه بالظبط: مافيش حاجة مقفولة.

    النداء فضل هنا مش في سبع حتة: المكان ده هو الطريق الوحيد اللي بيدخل الدفتر.
    """
    try:
        lock_date_service.assert_open(db, when, actor_user_id=actor_user_id)
    except LockDateError as exc:
        raise LedgerError(str(exc)) from exc


def _as_value(kind) -> str | None:
    """`PartnerKind.customer` أو "customer" — الاتنين بيتكتبوا نص في القاعدة."""
    if kind is None:
        return None
    return kind.value if isinstance(kind, PartnerKind) else str(kind)


def _build_lines(
    lines: list[LineInput],
    *,
    partner_kind: str | None = None,
    partner_id: int | None = None,
    date_maturity: date | None = None,
    cost_center_id: int | None = None,
) -> list[LedgerLine]:
    """يبني السطور، وبيورّث شريك القيد واستحقاقه ومركز تكلفته للسطر اللي ماقالش بتاعه.

    التوريث ده هو اللي بيخلّي الـ٢٧ نداء الموجودين ياخدوا الشريك من غير ما حد فيهم
    يتغيّر: المستند بيقول «الفاتورة دي على العميل ده» مرة واحدة، والسطور بتاخدها.
    ونفس الحكاية مع مركز التكلفة: المستند بيقول «ده بتاع المعرض» مرة، والسطور كلها
    بتتعلّم — والسطر اللي حدّد مركزه بنفسه (القيد اليدوي) بيغلب.
    """
    built: list[LedgerLine] = []
    for ln in lines:
        # النوع والرقم بيتورّثوا مع بعض: السطر اللي قال شريكه بيغلب بالكامل، واللي
        # سكت بياخد بتاع القيد بالكامل. خلطهم كان هيدّي «مورد برقم عميل».
        own = _as_value(ln.partner_kind) is not None or ln.partner_id is not None
        built.append(
            LedgerLine(
                account_id=ln.account_id,
                direction=ln.direction,
                amount=to_money(ln.amount),
                statement=ln.statement,
                cost_center_id=ln.cost_center_id or cost_center_id,
                partner_kind=_as_value(ln.partner_kind) if own else partner_kind,
                partner_id=ln.partner_id if own else partner_id,
                date_maturity=ln.date_maturity or date_maturity,
            )
        )
    return built


def _distribution_rows(db, line_id):
    from src.models.analytic import LedgerLineDistribution

    return db.scalars(
        select(LedgerLineDistribution).where(LedgerLineDistribution.line_id == line_id)
    ).all()


def _apply_distributions(db, built, inputs, document_distribution) -> None:
    """يكتب حصص التوزيع بعد ما السطور تاخد `id`.

    بعد الـ`flush` مش قبله: الحصة بتشاور على `ledger_line.id`، واللي لسه ماتكتبش
    مالوش رقم يتشاور عليه.
    """
    from src.services import analytic_service

    for line, source in zip(built, inputs):
        shares = source.cost_center_distribution or (
            document_distribution if source.cost_center_id is None else None
        )
        if shares:
            # التوزيع الغلط غلط في القيد، فبيطلع كـ`LedgerError` — كل نداء بيكتب
            # مستند بيمسك النوع ده أصلاً وبيرجّع ٤٠٩ بدل ٥٠٠.
            try:
                analytic_service.set_distribution(db, line=line, shares=shares)
            except analytic_service.AnalyticError as exc:
                raise LedgerError(str(exc)) from exc


def _assert_not_hashed(entry: LedgerEntry) -> None:
    """القيد في دفتر متجزّأ مايخرجش من الحسابات — الغلط بيتصحّح بقيد عكسي."""
    from src.services import secure_hash_service

    try:
        secure_hash_service.assert_alterable(entry)
    except secure_hash_service.HashChainError as exc:
        raise LedgerError(str(exc)) from exc


def _stamp_posted(db: Session, entry: LedgerEntry) -> None:
    """يحط القيد في دفتره ونوعه ويصرف له رقمه ويعلّمه مرحّل، ويفتح متبقّي سطوره."""
    if entry.journal_id is None:
        entry.journal_id = journal_registry.resolve(db, entry.entry_type).id
    if entry.move_type is None:
        entry.move_type = move_registry.move_type_for(entry.entry_type).value
    entry.state = EntryState.posted.value
    entry.posted_at = datetime.now()
    if not entry.number:
        journal = db.get(Journal, entry.journal_id)
        when = entry.entry_date or date.today()
        entry.number = journal_registry.next_number(db, journal=journal, when=when)
    # (المرحلة ٣) المتبقّي بيتفتح عند الترحيل مش عند الكتابة: المسودة مش في الحسابات،
    # فسطر عليه متبقّي وهو مسودة كان هيظهر في شاشة المطابقة كفلوس مستحقة ملهاش وجود.
    #
    # الاستيراد جوّه الدالة: `reconcile_service` بيقرا من هنا، والاستيراد فوق بيلف.
    from src.services import reconcile_service

    reconcile_service.stamp_residuals(db, entry)
    entry.payment_state = reconcile_service.payment_state_of(entry)
    # (المرحلة ٤) البصمة آخر حاجة: بتتحسب من الرقم والسطور بعد ما اتصرفوا.
    from src.services import secure_hash_service

    secure_hash_service.stamp(db, entry)


def post_entry(
    db: Session,
    *,
    entry_type: str,
    actor_user_id: int,
    lines: list[LineInput],
    description: str = "",
    rep_id: int | None = None,
    branch_id: int | None = None,
    reverses_entry_id: int | None = None,
    entry_date: date | None = None,
    journal_id: int | None = None,
    state: str = EntryState.posted.value,
    move_type: MoveType | str | None = None,
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
    # مركز تكلفة المستند كله. بيتورّث لكل سطر مالوش مركز بتاعه، فالمستند بيقوله مرة
    # واحدة بدل ما كل نداء يفضّل يكرّره على سطوره.
    cost_center_id: int | None = None,
    # وتوزيع المستند كله — نفس التوريث: السطر اللي مالوش توزيع ولا مركز بياخده.
    cost_center_distribution: dict | None = None,
) -> LedgerEntry:
    """يكتب قيد. الافتراضي مرحّل ومتوازن وبرقم؛ `state="draft"` بيسيبه ناقص وبلا رقم.

    كل مستند في النظام (بيع، شرا، سند، شيك، راتب) بينادي الدالة دي بالافتراضي، فسلوكه
    ما اتغيّرش غير إنه بقى ياخد رقم في دفتره — إلا لو طلع مش متوازن، وساعتها بيقع
    برسالة بتقول الفرق كام. ده مقصود: قيد مستند مش متوازن غلط في المستند نفسه.
    """
    _validate_lines(lines)
    if state == EntryState.posted.value:
        _assert_balanced(lines)
    _assert_period_open(db, entry_date, actor_user_id)
    kind = _as_value(partner_kind)
    # الاستحقاق الافتراضي هو تاريخ القيد — «مستحق دلوقتي»، وهو الصح للنقدي. اللي
    # بيبيع أجل بيبعت التاريخ بنفسه لحد ما شروط الدفع تتعمل.
    #
    # والقيد اللي جه من غير تاريخ (فاتورة اتكتبت من غير ما حد يحدد يومها) بياخد
    # النهارده: تاريخه المحاسبي الفعلي هو `created_at` زي ما بقية الكود بيقراه،
    # وسيبان الاستحقاق فاضي معناه إنه بيختفي من تقرير الأعمار خالص.
    due = invoice_date_due or entry_date or date.today()
    entry = LedgerEntry(
        entry_type=entry_type,
        description=description,
        actor_user_id=actor_user_id,
        rep_id=rep_id,
        branch_id=branch_id,
        reverses_entry_id=reverses_entry_id,
        entry_date=entry_date,
        journal_id=journal_id,
        state=state,
        move_type=(
            move_type.value if isinstance(move_type, MoveType)
            else move_type or move_registry.move_type_for(entry_type).value
        ),
        partner_kind=kind,
        partner_id=partner_id,
        invoice_date_due=due,
    )
    entry.lines = _build_lines(lines, partner_kind=kind, partner_id=partner_id,
                               date_maturity=due, cost_center_id=cost_center_id)
    db.add(entry)
    db.flush()
    _apply_distributions(db, entry.lines, lines, cost_center_distribution)
    if state == EntryState.posted.value:
        _stamp_posted(db, entry)
        db.flush()
    return entry


# --- دورة حياة المسودة ------------------------------------------------------------------


def _entry_lines_as_input(entry: LedgerEntry) -> list[LineInput]:
    return [
        LineInput(
            ln.account_id, ln.direction, ln.amount, ln.statement, ln.cost_center_id,
            ln.partner_kind, ln.partner_id, ln.date_maturity,
        )
        for ln in entry.lines
    ]


def create_draft(
    db: Session,
    *,
    entry_type: str,
    actor_user_id: int,
    lines: list[LineInput],
    description: str = "",
    branch_id: int | None = None,
    entry_date: date | None = None,
    journal_id: int | None = None,
    partner_kind: PartnerKind | str | None = None,
    partner_id: int | None = None,
    invoice_date_due: date | None = None,
) -> LedgerEntry:
    """قيد مسودة — مايدخلش الحسابات ومالوش رقم لحد ما يتّرحّل."""
    return post_entry(
        db, entry_type=entry_type, actor_user_id=actor_user_id, lines=lines,
        description=description, branch_id=branch_id, entry_date=entry_date,
        journal_id=journal_id, state=EntryState.draft.value,
        partner_kind=partner_kind, partner_id=partner_id,
        invoice_date_due=invoice_date_due,
    )


def replace_lines(db: Session, *, entry: LedgerEntry, lines: list[LineInput]) -> LedgerEntry:
    """يبدّل سطور مسودة. المرحّل مايتعدلش من هنا — يترجّع مسودة الأول."""
    if entry.state != EntryState.draft.value:
        raise LedgerError("القيد ده مش مسودة — رجّعه مسودة الأول عشان تعدّل سطوره.")
    _validate_lines(lines)
    for line in list(entry.lines):
        db.delete(line)
    db.flush()
    entry.lines = _build_lines(
        lines,
        partner_kind=entry.partner_kind,
        partner_id=entry.partner_id,
        date_maturity=entry.invoice_date_due or entry.entry_date,
    )
    db.flush()
    _apply_distributions(db, entry.lines, lines, None)
    return entry


def post_draft(db: Session, *, entry_id: int, actor_user_id: int | None = None) -> LedgerEntry:
    """يرحّل مسودة: بيتحقق من التوازن، بيحطها في دفترها، وبيصرف لها رقم."""
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise LedgerError("القيد مش موجود.")
    if entry.state == EntryState.posted.value:
        raise LedgerError("القيد مرحّل خلاص.")
    if entry.state == EntryState.cancelled.value:
        raise LedgerError("القيد ملغي — مايتّرحّلش.")
    inputs = _entry_lines_as_input(entry)
    _validate_lines(inputs)
    _assert_balanced(inputs)
    _assert_period_open(db, entry.entry_date, actor_user_id or entry.actor_user_id)
    _stamp_posted(db, entry)
    db.flush()
    return entry


def _release_residuals(db: Session, entry: LedgerEntry) -> None:
    """يقفل باب المطابقة على قيد خارج من الحسابات (رجوع لمسودة أو إلغاء).

    القيد اللي سطوره متقفلة على فواتير مايخرجش من الحسابات وهو سايب المطابقة
    وراه: الفاتورة التانية هتفضل مكتوب عليها «اتدفعت» بدفعة ملغية. الفك قرار
    صاحبه، فالنظام بيرفض ويقول اعمل إيه بدل ما يفك من ورا اللي عمل المطابقة.
    """
    from src.models.reconcile import PartialReconcile

    ids = [ln.id for ln in entry.lines]
    if ids:
        linked = db.scalar(
            select(PartialReconcile.id).where(
                PartialReconcile.debit_line_id.in_(ids)
                | PartialReconcile.credit_line_id.in_(ids)
            ).limit(1)
        )
        if linked is not None:
            raise LedgerError(
                "القيد ده متقفل على فواتير — فك المطابقة الأول من شاشة التسوية.")
    for line in entry.lines:
        line.amount_residual = None
    entry.payment_state = None


def reset_to_draft(db: Session, *, entry_id: int, actor_user_id: int | None = None) -> LedgerEntry:
    """يرجّع قيد مرحّل لمسودة — بيخرج من الحسابات وبيسيب رقمه محجوز.

    الرقم مابيرجعش للطابور: لو رجع، القيد اللي بعده كان هياخد رقم اتشاف قبل كده على
    ورقة مطبوعة. الفجوة في الترقيم أرخص من رقمين لقيدين مختلفين.
    """
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise LedgerError("القيد مش موجود.")
    if entry.state == EntryState.draft.value:
        return entry
    _assert_not_hashed(entry)
    # الخروج من الحسابات بيغيّر ميزانية الشهر بالظبط زي الدخول — فالقفل بيمنع الاتنين.
    _assert_period_open(db, entry.entry_date, actor_user_id or entry.actor_user_id)
    _release_residuals(db, entry)
    entry.state = EntryState.draft.value
    entry.posted_at = None
    db.flush()
    return entry


def cancel_entry(db: Session, *, entry_id: int, actor_user_id: int | None = None) -> LedgerEntry:
    """يلغي قيد — بيخرج من كل الحسابات والتقارير وبيفضل موجود بتاريخه ورقمه."""
    entry = db.get(LedgerEntry, entry_id)
    if entry is None:
        raise LedgerError("القيد مش موجود.")
    if entry.state == EntryState.posted.value:
        _assert_not_hashed(entry)
        _assert_period_open(db, entry.entry_date, actor_user_id or entry.actor_user_id)
    _release_residuals(db, entry)
    entry.state = EntryState.cancelled.value
    db.flush()
    return entry


def reverse_entry(db: Session, *, original_id: int, actor_user_id: int) -> LedgerEntry:
    """Create the mirror reversal of an entry (debits<->credits swapped).

    Enforces reverse-once (UNIQUE reverses_entry_id) and that a reversal is not re-reversible.
    """
    original = db.get(LedgerEntry, original_id)
    if original is None:
        raise LedgerError("القيد الأصلي مش موجود.")
    # «العكس مرة واحدة» و«العكسي مايتعكسش» اتشالوا: التعديل والحذف بقوا بيمسحوا أثر
    # المستند بدل ما يكتبوا قيد مضاد (شوف `document_edit_service`)، فالعكس بقى حاجة
    # نادرة بيعملها حد قاصدها — والقاعدة اللي كانت بتحميه من نفسه بقت بتقف قدامه.

    swapped = [
        LineInput(
            account_id=line.account_id,
            direction=(
                Direction.credit if line.direction == Direction.debit else Direction.debit
            ),
            amount=line.amount,
            statement=line.statement,
            cost_center_id=line.cost_center_id,  # reversal nets within the same cost center (006)
            # والتوزيع كمان — العكسي لازم يلغي نفس الحصص اللي الأصل وزّعها، وإلا
            # المركز بيفضل شايل مصروف اتعكس.
            cost_center_distribution={
                int(r.cost_center_id): to_money(r.percent)
                for r in _distribution_rows(db, line.id)
            } or None,
        )
        for line in original.lines
    ]
    return post_entry(
        db,
        entry_type="reversal",
        actor_user_id=actor_user_id,
        lines=swapped,
        description=f"Reversal of entry {original_id}",
        rep_id=original.rep_id,
        branch_id=original.branch_id,
        reverses_entry_id=original_id,
        # Reversal nets in the original's accounting period (005 analysis finding A/C).
        entry_date=original.entry_date,
        # العكسي بيفضل على نفس الشريك وبنوع مقلوب (فاتورة ← مردود)، زي إشعار الدائن.
        move_type=move_registry.reversed_move_type(original.move_type),
        partner_kind=original.partner_kind,
        partner_id=original.partner_id,
        invoice_date_due=original.invoice_date_due,
    )


def total_balance_of(db: Session, account_ids) -> Decimal:
    """The balances of many accounts, added up — in one query.

    `balance_of` loads every line of ONE account and sums them in Python, which is the right shape
    for one account and the wrong shape for all of them: totalling 233 customer accounts meant 233
    round trips and every ledger line in the system crossing the wire. Doing it twice inside the
    customer merge — once before and once after, to prove no money moved — took the request past
    the serverless timeout, and the merge came back 503 having done nothing.

    Same arithmetic, computed by the database: a line counts positive when its direction matches
    the account's normal side and negative when it does not.
    """
    ids = list(account_ids)
    if not ids:
        return ZERO
    signed = case(
        (LedgerLine.direction == Account.normal_side, LedgerLine.amount),
        else_=-LedgerLine.amount,
    )
    total = db.scalar(
        select(func.coalesce(func.sum(signed), 0))
        .select_from(LedgerLine)
        .join(Account, Account.id == LedgerLine.account_id)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id.in_(ids), is_posted_sql())
    )
    return to_money(total or 0)


def balance_of(db: Session, account_id: int) -> Decimal:
    """Derive an account's balance from its lines (signed by the account's normal side)."""
    account = db.get(Account, account_id)
    if account is None:
        raise LedgerError("الحساب مش موجود.")
    total = ZERO
    lines = db.scalars(
        select(LedgerLine)
        .join(LedgerEntry, LedgerEntry.id == LedgerLine.entry_id)
        .where(LedgerLine.account_id == account_id, is_posted_sql())
    ).all()
    for line in lines:
        signed = (
            to_money(line.amount)
            if line.direction == account.normal_side
            else -to_money(line.amount)
        )
        total += signed
    return to_money(total)
