"""قراية ملف جهاز البصمة — دوال نقية، من غير قاعدة بيانات (HR-2).

A fingerprint device exports a table: some identifier for the person, a date, and one or more
times. There is no standard for the columns, so the mapping is given by the caller and remembered
in settings rather than guessed here.

Two rules shape the whole thing:

**Rows that cannot be matched are RETURNED, never dropped.** A file with three unrecognised
identifiers must say so; silently importing the other forty-seven marks three people absent for
the month and nobody finds out until payroll.

**A day is built from the earliest and latest punch of that day**, not from the first two rows.
People punch in, out for lunch, back in, and out again — taking rows one and two makes a full day
look like ninety minutes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


class ImportError_(Exception):
    """الملف أو التعيين مش مفهومين."""


@dataclass
class ColumnMap:
    """أي عمود بيقابل إيه. الأرقام صفرية.

    `employee` may hold the employee code, the national id, or the name — matching tries all three,
    because which one a device prints depends on how it was set up years ago and nobody remembers.
    """

    employee: int
    day: int
    time: int | None = None
    check_in: int | None = None
    check_out: int | None = None


@dataclass
class Punch:
    employee_key: str
    day: date
    minutes: int | None = None
    check_in: str | None = None
    check_out: str | None = None


@dataclass
class ParsedFile:
    punches: list[Punch] = field(default_factory=list)
    #  (رقم السطر، السبب) — بيرجعوا للمستخدم، مابيتشالوش.
    rejected: list[tuple[int, str]] = field(default_factory=list)


_DATE_FORMATS = (
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%m/%d/%Y", "%d.%m.%Y",
)


def _digits(text: str) -> str:
    """الأرقام العربية الهندية بتيجي من أجهزة وإكسلات كتير."""
    return text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))


def parse_day(value: str) -> date:
    """بيقرا التاريخ بأي شكل شايع.

    `%d/%m/%Y` is tried before `%m/%d/%Y` on purpose: both parse «03/04/2026» and only one of them
    is what an Egyptian device meant. Ordering is the whole guard — there is nothing in the string
    to tell them apart.
    """
    text = _digits(str(value).strip())
    if not text:
        raise ImportError_("تاريخ فاضي")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    raise ImportError_(f"تاريخ مش مفهوم: {value}")


def parse(rows: list[list[str]], mapping: ColumnMap, *, skip_header: bool = True) -> ParsedFile:
    """بيحوّل صفوف الملف لبصمات. مابيلمسش قاعدة بيانات ومابيرميش صف."""
    out = ParsedFile()
    for index, raw in enumerate(rows):
        if skip_header and index == 0:
            continue
        line = index + 1
        try:
            cells = list(raw)
            need = max(x for x in (mapping.employee, mapping.day, mapping.time,
                                   mapping.check_in, mapping.check_out) if x is not None)
            if len(cells) <= need:
                out.rejected.append((line, "السطر ناقص أعمدة"))
                continue
            key = str(cells[mapping.employee]).strip()
            if not key:
                out.rejected.append((line, "مافيش رقم/اسم موظف"))
                continue
            day = parse_day(cells[mapping.day])
        except ImportError_ as exc:
            out.rejected.append((line, str(exc)))
            continue

        punch = Punch(employee_key=key, day=day)
        if mapping.check_in is not None:
            punch.check_in = str(cells[mapping.check_in]).strip() or None
        if mapping.check_out is not None:
            punch.check_out = str(cells[mapping.check_out]).strip() or None
        if mapping.time is not None:
            from src.lib.attendance_calc import AttendanceError, parse_hhmm

            try:
                punch.minutes = parse_hhmm(str(cells[mapping.time]))
            except AttendanceError as exc:
                out.rejected.append((line, str(exc)))
                continue
        out.punches.append(punch)
    return out


def fold_days(punches: list[Punch]) -> dict[tuple[str, date], dict]:
    """بيجمّع البصمات ليوم واحد لكل موظف — أول بصمة حضور وآخر واحدة انصراف.

    NOT the first two rows. People punch out for lunch and back in again, and a day built from rows
    one and two turns eight hours into ninety minutes — on the report, in the payroll, and in the
    argument with the employee that follows.

    A single punch on a day gives a check-in and no check-out, which is the honest reading: he was
    here, and when he left is not recorded.
    """
    from src.lib.attendance_calc import format_hhmm, parse_hhmm

    days: dict[tuple[str, date], dict] = {}
    for punch in punches:
        key = (punch.employee_key, punch.day)
        slot = days.setdefault(key, {"employee_key": punch.employee_key, "day": punch.day,
                                     "check_in": None, "check_out": None})
        stamps = []
        if punch.minutes is not None:
            stamps.append(punch.minutes)
        for explicit in (punch.check_in, punch.check_out):
            if explicit:
                value = parse_hhmm(explicit)
                if value is not None:
                    stamps.append(value)
        for value in stamps:
            current_in = parse_hhmm(slot["check_in"])
            current_out = parse_hhmm(slot["check_out"])
            if current_in is None or value < current_in:
                slot["check_in"] = format_hhmm(value)
            if current_out is None or value > current_out:
                slot["check_out"] = format_hhmm(value)
    # يوم فيه بصمة واحدة: حضور من غير انصراف، مش حضور وانصراف في نفس اللحظة.
    for slot in days.values():
        if slot["check_in"] == slot["check_out"]:
            slot["check_out"] = None
    return days
