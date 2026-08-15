"""قراية ملف جهاز البصمة.

Two properties carry the whole feature, and both fail silently if they are wrong:

* **صف مش متطابق بيرجع، مابيتشالش.** A file with three unrecognised identifiers has to say so.
  Importing the other forty-seven quietly marks three people absent for the month, and the first
  anybody hears of it is payroll.
* **اليوم بيتبني من أول بصمة وآخر بصمة.** People punch in, out for lunch, back in, out again.
  Building the day from rows one and two turns eight hours into ninety minutes — on the report, in
  the payroll, and in the argument with the employee that follows.
"""
from __future__ import annotations

from datetime import date

import pytest

from src.lib.attendance_import import ColumnMap, ImportError_, fold_days, parse, parse_day


class TestParseDay:
    def test_it_reads_the_common_shapes(self):
        assert parse_day("2026-08-14") == date(2026, 8, 14)
        assert parse_day("14/08/2026") == date(2026, 8, 14)
        assert parse_day("14-08-2026") == date(2026, 8, 14)

    def test_day_first_wins_over_month_first(self):
        """«03/04/2026» عندنا ٣ أبريل، مش ٤ مارس.

        Both patterns parse it and only one is what an Egyptian device meant. There is nothing in
        the string to tell them apart, so the ORDER the formats are tried in is the entire rule —
        which makes it worth a test, because reordering the tuple looks harmless.
        """
        assert parse_day("03/04/2026") == date(2026, 4, 3)

    def test_it_reads_arabic_indic_digits(self):
        assert parse_day("٢٠٢٦-٠٨-١٤") == date(2026, 8, 14)

    def test_it_ignores_a_time_stuck_on_the_end(self):
        assert parse_day("2026-08-14 08:30:00") == date(2026, 8, 14)

    @pytest.mark.parametrize("bad", ["", "   ", "غداً", "14/2026"])
    def test_it_refuses_what_it_cannot_read(self, bad):
        with pytest.raises(ImportError_):
            parse_day(bad)


class TestParse:
    def _rows(self):
        return [
            ["الموظف", "التاريخ", "الوقت"],
            ["EMP-0001", "2026-08-14", "08:30"],
            ["EMP-0001", "2026-08-14", "17:10"],
            ["EMP-0002", "2026-08-14", "09:00"],
        ]

    def test_it_reads_a_plain_file(self):
        out = parse(self._rows(), ColumnMap(employee=0, day=1, time=2))
        assert len(out.punches) == 3
        assert out.rejected == []
        assert out.punches[0].employee_key == "EMP-0001"

    def test_the_header_is_skipped(self):
        out = parse(self._rows(), ColumnMap(employee=0, day=1, time=2))
        assert all(p.employee_key != "الموظف" for p in out.punches)

    def test_a_bad_row_is_returned_not_dropped(self):
        """السطر اللي مااتقراش لازم يوصل للمستخدم — دي كل حكاية الاستيراد."""
        rows = self._rows() + [["EMP-0003", "مش تاريخ", "08:00"]]
        out = parse(rows, ColumnMap(employee=0, day=1, time=2))
        assert len(out.punches) == 3
        assert len(out.rejected) == 1
        line, reason = out.rejected[0]
        assert line == 5, "رقم السطر غلط — المستخدم مش هيلاقيه في الملف"
        assert "تاريخ" in reason

    def test_a_row_with_no_employee_is_returned(self):
        rows = self._rows() + [["", "2026-08-14", "08:00"]]
        out = parse(rows, ColumnMap(employee=0, day=1, time=2))
        assert len(out.rejected) == 1

    def test_a_short_row_is_returned(self):
        rows = self._rows() + [["EMP-0003"]]
        out = parse(rows, ColumnMap(employee=0, day=1, time=2))
        assert len(out.rejected) == 1
        assert "ناقص" in out.rejected[0][1]

    def test_it_reads_separate_in_and_out_columns(self):
        rows = [
            ["الموظف", "التاريخ", "حضور", "انصراف"],
            ["EMP-0001", "2026-08-14", "08:30", "17:10"],
        ]
        out = parse(rows, ColumnMap(employee=0, day=1, check_in=2, check_out=3))
        assert out.punches[0].check_in == "08:30"
        assert out.punches[0].check_out == "17:10"


class TestFoldDays:
    def test_the_day_runs_from_the_first_punch_to_the_last(self):
        """أربع بصمات — الأولى حضور والأخيرة انصراف.

        Punched in at 08:30, out for lunch at 13:00, back at 14:00, home at 17:10. Taking rows one
        and two would call that four and a half hours.
        """
        out = parse([
            ["h", "d", "t"],
            ["EMP-1", "2026-08-14", "08:30"],
            ["EMP-1", "2026-08-14", "13:00"],
            ["EMP-1", "2026-08-14", "14:00"],
            ["EMP-1", "2026-08-14", "17:10"],
        ], ColumnMap(employee=0, day=1, time=2))
        days = fold_days(out.punches)
        day = days[("EMP-1", date(2026, 8, 14))]
        assert day["check_in"] == "08:30"
        assert day["check_out"] == "17:10"

    def test_punches_out_of_order_still_fold_correctly(self):
        """الملف مش مرتّب دايماً — الترتيب مايغيّرش اليوم."""
        out = parse([
            ["h", "d", "t"],
            ["EMP-1", "2026-08-14", "17:10"],
            ["EMP-1", "2026-08-14", "08:30"],
        ], ColumnMap(employee=0, day=1, time=2))
        day = fold_days(out.punches)[("EMP-1", date(2026, 8, 14))]
        assert day["check_in"] == "08:30"
        assert day["check_out"] == "17:10"

    def test_one_punch_is_an_arrival_with_no_departure(self):
        """بصم ونسي يبصم خروج — «حضر ومش معروف مشي إمتى»، مش «حضر ومشي في نفس اللحظة»."""
        out = parse([["h", "d", "t"], ["EMP-1", "2026-08-14", "08:30"]],
                    ColumnMap(employee=0, day=1, time=2))
        day = fold_days(out.punches)[("EMP-1", date(2026, 8, 14))]
        assert day["check_in"] == "08:30"
        assert day["check_out"] is None

    def test_days_and_people_are_kept_apart(self):
        out = parse([
            ["h", "d", "t"],
            ["EMP-1", "2026-08-14", "08:30"],
            ["EMP-1", "2026-08-15", "09:00"],
            ["EMP-2", "2026-08-14", "10:00"],
        ], ColumnMap(employee=0, day=1, time=2))
        days = fold_days(out.punches)
        assert len(days) == 3
        assert days[("EMP-1", date(2026, 8, 15))]["check_in"] == "09:00"
        assert days[("EMP-2", date(2026, 8, 14))]["check_in"] == "10:00"

    def test_an_empty_file_folds_to_nothing(self):
        assert fold_days([]) == {}
