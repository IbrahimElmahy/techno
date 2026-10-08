from __future__ import annotations

import os
from datetime import date, datetime, timedelta


def business_utc_offset_hours() -> float:
    try:
        return float(os.getenv("BUSINESS_UTC_OFFSET_HOURS", "3"))
    except ValueError:
        return 3.0


def _offset() -> timedelta:
    return timedelta(hours=business_utc_offset_hours())


def day_start_utc(day: date | str) -> datetime:
    d = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    return datetime(d.year, d.month, d.day) - _offset()


def day_end_utc(day: date | str) -> datetime:
    d = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    return day_start_utc(d + timedelta(days=1))


def today() -> date:
    return (datetime.utcnow() + _offset()).date()
