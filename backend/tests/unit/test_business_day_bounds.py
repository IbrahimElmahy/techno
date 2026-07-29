"""حدود اليوم بتوقيت المكتب — a business day is a pair of UTC instants, not a SQL `date()`.

Timestamps are stored in UTC. Every date filter used to reduce them with SQL `date()` and compare the
result to a calendar date the user typed, which is wrong anywhere east of Greenwich: Egypt runs
UTC+2/+3, so a document entered at 00:30 on the 30th is stamped 21:30 on the 29th and `date()` calls
it the 29th.

That is not a rounding curiosity. Every night between midnight and 02:00–03:00 local, invoices,
movements and permits landed on the *previous* day in the stock as-of-date report, the item card and
the sales list. It was found by the stock as-of test failing at 00:10 local — the report claimed
goods bought "today" already existed "yesterday", because in UTC they did.

These are unit tests on the bounds themselves, so the property is pinned independently of whatever
hour the suite happens to run at.
"""
import os
from datetime import date, datetime

import pytest

from src.core import clock


@pytest.fixture()
def cairo_summer(monkeypatch):
    monkeypatch.setenv("BUSINESS_UTC_OFFSET_HOURS", "3")
    yield
    os.environ.pop("BUSINESS_UTC_OFFSET_HOURS", None)


def test_the_day_starts_before_midnight_utc(cairo_summer):
    """00:00 on the 30th in Cairo is 21:00 on the 29th in UTC."""
    assert clock.day_start_utc(date(2026, 7, 30)) == datetime(2026, 7, 29, 21, 0)


def test_the_day_ends_at_the_next_day_start(cairo_summer):
    """Exclusive, so nothing can fall in a gap between one day's end and the next day's start.

    A `<= 23:59:59` bound would lose a timestamp carrying microseconds at the very end of the day —
    it would belong to neither day, and a row that appears in no report at all is the hardest kind of
    missing data to notice.
    """
    end = clock.day_end_utc(date(2026, 7, 30))
    assert end == datetime(2026, 7, 30, 21, 0)
    assert end == clock.day_start_utc(date(2026, 7, 31))


def test_a_timestamp_just_after_local_midnight_belongs_to_the_new_day(cairo_summer):
    """The exact case that was broken: 00:30 local on the 30th = 21:30 UTC on the 29th."""
    stamped = datetime(2026, 7, 29, 21, 30)   # what the database records
    assert stamped >= clock.day_start_utc(date(2026, 7, 30))
    assert stamped < clock.day_end_utc(date(2026, 7, 30))
    # And it does NOT belong to the 29th, which is what `date(created_at)` used to say.
    assert not stamped < clock.day_end_utc(date(2026, 7, 29))


def test_a_timestamp_just_before_local_midnight_belongs_to_the_old_day(cairo_summer):
    stamped = datetime(2026, 7, 29, 20, 30)   # 23:30 local on the 29th
    assert stamped >= clock.day_start_utc(date(2026, 7, 29))
    assert stamped < clock.day_end_utc(date(2026, 7, 29))


def test_strings_are_accepted_because_that_is_what_arrives_from_a_query_string(cairo_summer):
    assert clock.day_start_utc("2026-07-30") == clock.day_start_utc(date(2026, 7, 30))
    assert clock.day_end_utc("2026-07-30T00:00:00") == clock.day_end_utc(date(2026, 7, 30))


def test_the_offset_is_configurable_for_a_deployment_elsewhere(monkeypatch):
    """The office decides the day boundary, not the server it happens to run on."""
    monkeypatch.setenv("BUSINESS_UTC_OFFSET_HOURS", "0")
    assert clock.day_start_utc(date(2026, 7, 30)) == datetime(2026, 7, 30, 0, 0)
    monkeypatch.setenv("BUSINESS_UTC_OFFSET_HOURS", "-5")
    assert clock.day_start_utc(date(2026, 7, 30)) == datetime(2026, 7, 30, 5, 0)


def test_a_nonsense_offset_falls_back_instead_of_crashing_every_report(monkeypatch):
    """A typo in an environment variable must not take down every date filter in the system."""
    monkeypatch.setenv("BUSINESS_UTC_OFFSET_HOURS", "three")
    assert clock.business_utc_offset_hours() == 3.0
