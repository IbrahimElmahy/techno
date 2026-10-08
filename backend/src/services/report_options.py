from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

COMPARISON_NONE = "none"
COMPARISON_PREVIOUS = "previous"
COMPARISON_LAST_YEAR = "last_year"

COMPARISONS = (COMPARISON_NONE, COMPARISON_PREVIOUS, COMPARISON_LAST_YEAR)

COMPARISON_LABEL = {
    COMPARISON_PREVIOUS: "الفترة السابقة",
    COMPARISON_LAST_YEAR: "نفس الفترة العام الماضي",
}


@dataclass(frozen=True)
class ReportOptions:
    date_from: date | None = None
    date_to: date | None = None
    posted_only: bool = True
    comparison: str = COMPARISON_NONE

    @property
    def compares(self) -> bool:
        return self.comparison in (COMPARISON_PREVIOUS, COMPARISON_LAST_YEAR)


def _minus_year(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        return day.replace(year=day.year - 1, day=28)


def comparison_window(options: ReportOptions) -> tuple[date | None, date | None]:
    if not options.compares:
        return None, None
    start, end = options.date_from, options.date_to
    if options.comparison == COMPARISON_LAST_YEAR:
        return (_minus_year(start) if start else None,
                _minus_year(end) if end else None)
    if end is None:
        return None, None
    if start is None:
        return None, end - timedelta(days=1)
    span = (end - start).days
    prev_end = start - timedelta(days=1)
    return prev_end - timedelta(days=span), prev_end


def comparison_label(options: ReportOptions) -> str | None:
    if not options.compares:
        return None
    start, end = comparison_window(options)
    label = COMPARISON_LABEL.get(options.comparison, "")
    if end is None:
        return label
    span = f"{start:%Y-%m-%d} ← {end:%Y-%m-%d}" if start else f"حتى {end:%Y-%m-%d}"
    return f"{label} ({span})"
