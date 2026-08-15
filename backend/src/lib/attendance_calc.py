"""حساب اليوم من مواعيده — دوال نقية، من غير قاعدة بيانات (HR-2).

Same shape as `src/lib/depreciation.py`: the arithmetic lives here with no session in any
signature, so it can be tested directly against cases somebody can check by hand — and so the
service above it is only about *which* rows to write, never about how a figure is reached.

Times are `HH:MM` strings throughout, because that is what the shift table holds and what a
fingerprint export prints. Converting to `time` objects at the edges and back again buys nothing
and loses the ability to say «مالوش انصراف» as an absent value rather than a sentinel.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from src.core.money import to_qty

ZERO_QTY = Decimal("0.000")


class AttendanceError(Exception):
    """الوقت أو الوردية مش مفهومين."""


def parse_hhmm(value: str | None) -> int | None:
    """«08:30» → 510 دقيقة من نص الليل. بيرجّع None للفاضي.

    Tolerant of what a device actually prints: `8:5`, `08:05:33`, and Arabic-Indic digits all
    arrive in real exports. Refusing them means a row silently skipped and an employee marked
    absent on a day he was there.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    # الأرقام العربية الهندية — بتيجي من أجهزة وإكسلات كتير.
    text = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    parts = text.split(":")
    if len(parts) < 2:
        raise AttendanceError(f"وقت مش مفهوم: {value}")
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise AttendanceError(f"وقت مش مفهوم: {value}") from exc
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        raise AttendanceError(f"وقت خارج اليوم: {value}")
    return hours * 60 + minutes


def format_hhmm(minutes: int | None) -> str | None:
    if minutes is None:
        return None
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def weekend_days(csv: str | None) -> set[int]:
    """«4,5» → {4, 5}. أرقام ISO: الاتنين ٠ والأحد ٦."""
    if not csv:
        return set()
    out = set()
    for part in str(csv).split(","):
        part = part.strip()
        if part.isdigit() and 0 <= int(part) <= 6:
            out.add(int(part))
    return out


def is_weekend(day: date, csv: str | None) -> bool:
    return day.weekday() in weekend_days(csv)


def shift_span(start: str, end: str) -> int:
    """طول الوردية بالدقايق، والليلية محسوبة صح.

    A shift from 22:00 to 06:00 is eight hours, not minus sixteen. Getting this wrong makes every
    night worker's overtime negative, which reads as a bug in overtime rather than in the span.
    """
    begin, finish = parse_hhmm(start), parse_hhmm(end)
    if begin is None or finish is None:
        raise AttendanceError("الوردية مالهاش بداية أو نهاية.")
    return finish - begin if finish > begin else (24 * 60) - begin + finish


def elapsed(check_in: str | None, check_out: str | None) -> int | None:
    """الدقايق بين الحضور والانصراف، والليلي محسوب صح. None لو ناقص طرف."""
    begin, finish = parse_hhmm(check_in), parse_hhmm(check_out)
    if begin is None or finish is None:
        return None
    return finish - begin if finish >= begin else (24 * 60) - begin + finish


def lateness(check_in: str | None, shift_start: str, grace_minutes: int = 0) -> int:
    """دقايق التأخير بعد السماح. الحضور بدري مش رصيد — بيرجّع صفر مش سالب."""
    arrived = parse_hhmm(check_in)
    expected = parse_hhmm(shift_start)
    if arrived is None or expected is None:
        return 0
    late = arrived - expected - max(0, grace_minutes)
    return max(0, late)


def early_leave(check_out: str | None, shift_end: str) -> int:
    """دقايق الانصراف المبكر. القعدة بعد الميعاد مش انصراف مبكر بالسالب."""
    left = parse_hhmm(check_out)
    expected = parse_hhmm(shift_end)
    if left is None or expected is None:
        return 0
    return max(0, expected - left)


def day_figures(
    *,
    check_in: str | None,
    check_out: str | None,
    shift_start: str,
    shift_end: str,
    break_minutes: int = 0,
    grace_minutes: int = 0,
) -> dict:
    """كل أرقام اليوم من مواعيده.

    Overtime is measured against the shift's own length, not against a fixed eight hours: a
    six-hour shift worked for seven is an hour over, and a company that runs two shift lengths
    would otherwise pay one of them wrong every day.

    Break time comes off worked hours because it is not worked. It does NOT change overtime: it is
    subtracted from what he did and from what was expected of him alike, so it cancels in the
    difference. Worth saying because the intuition runs the other way — the worry is that a long
    lunch becomes paid overtime, and the reason it cannot is this cancellation, not a special case.
    """
    span = shift_span(shift_start, shift_end)
    present = elapsed(check_in, check_out)
    worked_minutes = max(0, (present or 0) - max(0, break_minutes))
    expected_minutes = max(0, span - max(0, break_minutes))
    over = max(0, worked_minutes - expected_minutes) if present is not None else 0
    return {
        "late_minutes": lateness(check_in, shift_start, grace_minutes),
        "early_leave_minutes": early_leave(check_out, shift_end),
        "worked_hours": to_qty(Decimal(worked_minutes) / 60) if present is not None else ZERO_QTY,
        "overtime_hours": to_qty(Decimal(over) / 60),
    }
