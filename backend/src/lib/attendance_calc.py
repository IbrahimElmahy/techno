from __future__ import annotations

from datetime import date
from decimal import Decimal

from src.core.money import to_qty

ZERO_QTY = Decimal("0.000")


class AttendanceError(Exception):
    pass


def parse_hhmm(value: str | None) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    parts = text.split(":")
    if len(parts) < 2:
        raise AttendanceError(f"وقت غير مفهوم: {value}")
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise AttendanceError(f"وقت غير مفهوم: {value}") from exc
    if not (0 <= hours <= 23 and 0 <= minutes <= 59):
        raise AttendanceError(f"وقت خارج اليوم: {value}")
    return hours * 60 + minutes


def format_hhmm(minutes: int | None) -> str | None:
    if minutes is None:
        return None
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def weekend_days(csv: str | None) -> set[int]:
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
    begin, finish = parse_hhmm(start), parse_hhmm(end)
    if begin is None or finish is None:
        raise AttendanceError("ليس للوردية بداية أو نهاية.")
    return finish - begin if finish > begin else (24 * 60) - begin + finish


def elapsed(check_in: str | None, check_out: str | None) -> int | None:
    begin, finish = parse_hhmm(check_in), parse_hhmm(check_out)
    if begin is None or finish is None:
        return None
    return finish - begin if finish >= begin else (24 * 60) - begin + finish


def lateness(check_in: str | None, shift_start: str, grace_minutes: int = 0) -> int:
    arrived = parse_hhmm(check_in)
    expected = parse_hhmm(shift_start)
    if arrived is None or expected is None:
        return 0
    late = arrived - expected - max(0, grace_minutes)
    return max(0, late)


def early_leave(check_out: str | None, shift_end: str) -> int:
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
