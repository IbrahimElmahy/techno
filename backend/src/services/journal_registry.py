"""توجيه القيود لدفاترها، وصرف أرقامها.

المصدر الوحيد اللي بيقول «قيد نوعه كذا بيروح لأنهي دفتر». الخريطة مكتوبة هنا مرة
واحدة بدل ما كل موديول يختار دفتره — عشان الموديول اللي بينسى يختار مايبقاش قيده
بره كل الدفاتر.

الدفاتر بتتزرع لوحدها أول ما حد يحتاج واحد منها (`ensure_seeded`)، فالقاعدة الفاضية
والقاعدة الشغّالة بيوصلوا لنفس الحالة من غير خطوة يدوية.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.models.journal import Journal, JournalKind, JournalSequence

# --- تعريف الدفاتر القياسية -------------------------------------------------------------

# (كود، اسم، نوع، ترتيب)
_JOURNALS: list[tuple[str, str, JournalKind, int]] = [
    ("OPN", "الأرصدة الافتتاحية", JournalKind.general, 10),
    ("INV", "المبيعات", JournalKind.sale, 20),
    ("BILL", "المشتريات", JournalKind.purchase, 30),
    ("CSH", "الخزنة والنقدية", JournalKind.cash, 40),
    ("BNK", "الشيكات والبنك", JournalKind.bank, 50),
    ("PAY", "الرواتب والعُهد", JournalKind.general, 60),
    ("AST", "الأصول الثابتة", JournalKind.general, 70),
    ("LOY", "النقاط والكوبونات", JournalKind.general, 80),
    ("MISC", "قيود متنوعة", JournalKind.general, 90),
]

# نوع القيد → كود الدفتر. الأنواع دي هي الـ٢٣ اللي بيكتبها الكود دلوقتي؛ أي نوع جديد
# مش هنا بيقع على `MISC`، وده أحسن من إنه يقع بره الدفاتر خالص.
_ROUTING: dict[str, str] = {
    "opening_balance": "OPN",
    "sale": "INV",
    "sale_return": "INV",
    "purchase": "BILL",
    "purchase_return": "BILL",
    "receipt": "CSH",
    "payment": "CSH",
    "expense": "CSH",
    "cash_transfer": "CSH",
    "rep_handover": "CSH",
    "cheque_register": "BNK",
    "cheque_settle": "BNK",
    "cheque_bounce": "BNK",
    "payroll_accrual": "PAY",
    "payroll_payment": "PAY",
    "payroll_remittance": "PAY",
    "employee_advance": "PAY",
    "depreciation": "AST",
    "asset_disposal": "AST",
    "coupon_redeem": "LOY",
    "coupon_redeem_reverse": "LOY",
    "journal": "MISC",
    "reversal": "MISC",
}

FALLBACK_CODE = "MISC"


def journal_code_for(entry_type: str) -> str:
    """كود الدفتر اللي نوع القيد ده بيروح له."""
    return _ROUTING.get(entry_type, FALLBACK_CODE)


def is_known_type(entry_type: str) -> bool:
    """نوع القيد ده في الخريطة ولا وقع على MISC؟ — سكربت النقل بيعدّ اللي وقع."""
    return entry_type in _ROUTING


def ensure_seeded(db: Session) -> None:
    """يعمل الدفاتر القياسية لو مش موجودة. Idempotent — بيتنادى قبل أي توجيه."""
    have = {j.code for j in db.scalars(select(Journal)).all()}
    missing = [j for j in _JOURNALS if j[0] not in have]
    if not missing:
        return
    for code, name, kind, order in missing:
        db.add(
            Journal(
                code=code, name=name, kind=kind.value,
                is_system=True, sort_order=order, active=True,
            )
        )
    db.flush()


def get_by_code(db: Session, code: str) -> Journal | None:
    return db.scalar(select(Journal).where(Journal.code == code))


def resolve(db: Session, entry_type: str) -> Journal:
    """الدفتر بتاع نوع القيد ده — بيتزرع لو القاعدة لسه فاضية."""
    ensure_seeded(db)
    code = journal_code_for(entry_type)
    journal = get_by_code(db, code)
    if journal is None:  # حد مسح دفتر نظام بالإيد — MISC بيستقبل بدل ما القيد يقع
        journal = get_by_code(db, FALLBACK_CODE)
    if journal is None:  # pragma: no cover — ensure_seeded لسه عاملهم
        raise RuntimeError("مافيش دفاتر يومية في القاعدة.")
    return journal


# --- الترقيم ----------------------------------------------------------------------------

NUMBER_WIDTH = 5


def format_number(code: str, year: int, seq: int) -> str:
    return f"{code}/{year}/{seq:0{NUMBER_WIDTH}d}"


def next_number(db: Session, *, journal: Journal, when: date) -> str:
    """يصرف الرقم اللي بعده في دفتر السنة دي، ويقفل الصف لحد ما المعاملة تخلص.

    القفل (`with_for_update`) هو اللي بيمنع قيدين اتّرحّلوا في نفس اللحظة من إنهم
    ياخدوا نفس الرقم؛ من غيره الاتنين بيقروا نفس `last_number` وبيكتبوا نفس القيمة.
    """
    year = when.year
    row = db.scalar(
        select(JournalSequence)
        .where(JournalSequence.journal_id == journal.id, JournalSequence.year == year)
        .with_for_update()
    )
    if row is None:
        row = JournalSequence(journal_id=journal.id, year=year, last_number=0)
        db.add(row)
        db.flush()
    row.last_number = int(row.last_number or 0) + 1
    db.flush()
    return format_number(journal.code, year, row.last_number)
