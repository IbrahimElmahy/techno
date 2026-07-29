"""Turning a business day into the UTC instants that bound it.

Timestamps are stored in UTC (`server_default=func.now()`), and every date filter in the system used
to reduce them with SQL `date()` and compare that to a calendar date the user typed. Those two are
not the same thing anywhere east of Greenwich: Egypt runs UTC+2/+3, so a document entered at 00:30
on the 30th is stamped 21:30 on the 29th, and `date(created_at)` calls it the 29th.

The effect was not theoretical. Every night between midnight and 02:00–03:00 local, invoices,
movements and permits landed on the previous day in every report that filters by date — the stock
as-of-date report, the item card, the sales list. A shop that closes late would find yesterday's
takings padded with tonight's, and «الرصيد في تاريخ» for a day before a purchase would already show
the goods.

So the comparison is done the other way round: the day the user means is converted into the pair of
UTC instants that bound it, and the stored timestamp is compared against those. That is exact, needs
no SQL date function, and behaves identically on SQLite and MySQL — the previous approach depended on
each engine's `date()` and on the server's clock happening to be in the same day as the office.

The offset is configurable because the office decides it, not the server. Default +3 (Cairo summer
time) since that is where this system runs; a deployment elsewhere sets `BUSINESS_UTC_OFFSET_HOURS`.
A fixed offset rather than a named zone is a deliberate simplification: a named zone would need the
tz database at SQL level, and the only cost of the fixed offset is a one-hour edge during the weeks
Egypt is on winter time — inside the 00:00–01:00 window, on the reporting boundary only.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta


def business_utc_offset_hours() -> float:
    """Hours the office's calendar day runs ahead of UTC. Read per call so tests can vary it."""
    try:
        return float(os.getenv("BUSINESS_UTC_OFFSET_HOURS", "3"))
    except ValueError:
        return 3.0


def _offset() -> timedelta:
    return timedelta(hours=business_utc_offset_hours())


def day_start_utc(day: date | str) -> datetime:
    """The UTC instant at which this business day begins (inclusive)."""
    d = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    return datetime(d.year, d.month, d.day) - _offset()


def day_end_utc(day: date | str) -> datetime:
    """The UTC instant at which this business day ends — exclusive, i.e. the next day's start.

    Exclusive rather than 23:59:59 so nothing can fall in a gap: a timestamp with microseconds at
    the very end of the day would slip past a `<= 23:59:59` bound and vanish from both days.
    """
    d = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    return day_start_utc(d + timedelta(days=1))


def today() -> date:
    """The current business day — not necessarily the server's, which is the whole point."""
    return (datetime.utcnow() + _offset()).date()
