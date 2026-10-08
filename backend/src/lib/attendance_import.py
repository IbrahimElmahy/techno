from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime


class ImportError_(Exception):
    pass


@dataclass
class ColumnMap:
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
    rejected: list[tuple[int, str]] = field(default_factory=list)


_DATE_FORMATS = (
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%m/%d/%Y", "%d.%m.%Y",
)


def _digits(text: str) -> str:
    return text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))


def parse_day(value: str) -> date:
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
    for slot in days.values():
        if slot["check_in"] == slot["check_out"]:
            slot["check_out"] = None
    return days
