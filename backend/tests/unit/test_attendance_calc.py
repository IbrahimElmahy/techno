"""حساب يوم الحضور — أرقام حد يقدر يراجعها بإيده.

Pure functions, no session, so every case here can be checked against a clock rather than against
the code that produced it. Three of these are the ones that go wrong quietly:

* **الوردية الليلية.** 22:00 → 06:00 is eight hours, not minus sixteen. Get the sign wrong and
  every night worker's overtime is negative, which reads as a bug in overtime rather than in the
  span, and gets "fixed" by clamping — hiding it for good.
* **الحضور بدري مش رصيد.** Arriving twenty minutes early must not net off twenty minutes of
  lateness later in the week. A `max(0, …)` is the whole of that rule.
* **الأرقام العربية الهندية.** Fingerprint exports and Excel sheets print «٠٨:٣٠» routinely. A
  parser that refuses them skips the row, and a skipped row is an employee marked absent on a day
  he was standing there.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from src.lib.attendance_calc import (
    AttendanceError,
    day_figures,
    early_leave,
    elapsed,
    format_hhmm,
    is_weekend,
    lateness,
    parse_hhmm,
    shift_span,
    weekend_days,
)


class TestParsing:
    def test_it_reads_an_ordinary_time(self):
        assert parse_hhmm("08:30") == 8 * 60 + 30

    def test_it_reads_what_devices_actually_print(self):
        assert parse_hhmm("8:5") == 8 * 60 + 5
        assert parse_hhmm("08:05:33") == 8 * 60 + 5, "ثواني الجهاز كسرت القراية"
        assert parse_hhmm(" 08:30 ") == 8 * 60 + 30

    def test_it_reads_arabic_indic_digits(self):
        # «٠٨:٣٠» — بيطلع من أجهزة البصمة والإكسلات العربي على طول.
        assert parse_hhmm("٠٨:٣٠") == 8 * 60 + 30

    def test_nothing_is_nothing_not_midnight(self):
        # `None` و«» معناهم «مافيش بصمة»، مش «الساعة ١٢ بالليل».
        assert parse_hhmm(None) is None
        assert parse_hhmm("") is None
        assert parse_hhmm("   ") is None

    @pytest.mark.parametrize("bad", ["ص", "0830", "25:00", "08:99"])
    def test_it_refuses_what_it_cannot_read(self, bad):
        with pytest.raises(AttendanceError):
            parse_hhmm(bad)

    def test_it_writes_back_what_it_read(self):
        assert format_hhmm(parse_hhmm("08:05")) == "08:05"
        assert format_hhmm(None) is None


class TestShiftSpan:
    def test_a_day_shift(self):
        assert shift_span("09:00", "17:00") == 480

    def test_a_night_shift_is_positive(self):
        """22:00 → 06:00 تمن ساعات، مش سالب ستاشر."""
        assert shift_span("22:00", "06:00") == 480

    def test_elapsed_crosses_midnight_too(self):
        assert elapsed("22:15", "06:15") == 480
        assert elapsed("09:00", "17:30") == 510

    def test_elapsed_needs_both_ends(self):
        assert elapsed("09:00", None) is None
        assert elapsed(None, "17:00") is None


class TestLateness:
    def test_late_is_counted_after_the_grace(self):
        assert lateness("09:20", "09:00", grace_minutes=15) == 5

    def test_inside_the_grace_is_not_late(self):
        assert lateness("09:10", "09:00", grace_minutes=15) == 0

    def test_arriving_early_is_not_credit(self):
        """جه بدري بعشرين دقيقة — مش رصيد يقاصّ بيه تأخير يوم تاني."""
        assert lateness("08:40", "09:00", grace_minutes=0) == 0

    def test_no_punch_is_not_lateness(self):
        # اليوم من غير بصمة بيتعالج كغياب أو حضور كامل حسب السياسة — مش كتأخير ٩ ساعات.
        assert lateness(None, "09:00") == 0

    def test_leaving_late_is_not_early_leave(self):
        assert early_leave("18:00", "17:00") == 0
        assert early_leave("16:30", "17:00") == 30


class TestWeekend:
    def test_it_reads_the_csv(self):
        assert weekend_days("4,5") == {4, 5}
        assert weekend_days("") == set()
        assert weekend_days(None) == set()

    def test_it_ignores_rubbish_rather_than_failing(self):
        # A settings field somebody typed into by hand must not take attendance down.
        assert weekend_days("4, 5, x, 9") == {4, 5}

    def test_friday_and_saturday(self):
        assert is_weekend(date(2026, 8, 14), "4,5") is True   # جمعة
        assert is_weekend(date(2026, 8, 15), "4,5") is True   # سبت
        assert is_weekend(date(2026, 8, 16), "4,5") is False  # حد


class TestDayFigures:
    def test_a_full_ordinary_day(self):
        f = day_figures(check_in="09:00", check_out="17:00",
                        shift_start="09:00", shift_end="17:00")
        assert f["late_minutes"] == 0
        assert f["worked_hours"] == Decimal("8.000")
        assert f["overtime_hours"] == Decimal("0.000")

    def test_overtime_is_measured_against_this_shift_not_eight_hours(self):
        """وردية ست ساعات اشتغلت سبعة = ساعة إضافي.

        A company running two shift lengths would otherwise pay one of them wrong every single day.
        """
        f = day_figures(check_in="09:00", check_out="16:00",
                        shift_start="09:00", shift_end="15:00")
        assert f["overtime_hours"] == Decimal("1.000")

    def test_the_break_comes_off_worked_hours(self):
        """ساعة الغدا مش شغل — فبتتشال من الساعات المشتغلة.

        Nine to five with an hour's break is seven hours worked, not eight. Somebody paid by the
        hour and somebody looking at «اشتغل كام» both need the seven.
        """
        f = day_figures(check_in="09:00", check_out="17:00",
                        shift_start="09:00", shift_end="17:00", break_minutes=60)
        assert f["worked_hours"] == Decimal("7.000")
        assert f["overtime_hours"] == Decimal("0.000"), "الغدا اتحسب إضافي"

    def test_the_break_does_not_change_overtime(self):
        """الاستراحة بتتشال من الاتنين، فبتتلغي في الفرق.

        Nine to six against a nine-to-five shift is an hour over, break or no break — the break is
        subtracted from what he did AND from what was expected of him. Worth pinning because the
        obvious worry is the opposite one (a long lunch quietly becoming paid overtime), and this
        says in one case why that cannot happen.
        """
        with_break = day_figures(check_in="09:00", check_out="18:00",
                                 shift_start="09:00", shift_end="17:00", break_minutes=60)
        without = day_figures(check_in="09:00", check_out="18:00",
                              shift_start="09:00", shift_end="17:00")
        assert with_break["overtime_hours"] == Decimal("1.000")
        assert with_break["overtime_hours"] == without["overtime_hours"]
        # لكن الساعات المشتغلة بتفرق — وده المقصود.
        assert with_break["worked_hours"] == Decimal("8.000")
        assert without["worked_hours"] == Decimal("9.000")

    def test_a_night_shift_pays_normally(self):
        f = day_figures(check_in="22:00", check_out="06:00",
                        shift_start="22:00", shift_end="06:00")
        assert f["worked_hours"] == Decimal("8.000")
        assert f["overtime_hours"] == Decimal("0.000")

    def test_a_day_with_no_checkout_earns_no_hours_and_no_overtime(self):
        """بصم دخول ونسي الخروج — مش تمن ساعات ومش سالب. صفر، والمشرف يشوفها."""
        f = day_figures(check_in="09:00", check_out=None,
                        shift_start="09:00", shift_end="17:00")
        assert f["worked_hours"] == Decimal("0.000")
        assert f["overtime_hours"] == Decimal("0.000")

    def test_late_and_early_on_the_same_day(self):
        f = day_figures(check_in="09:30", check_out="16:30",
                        shift_start="09:00", shift_end="17:00", grace_minutes=10)
        assert f["late_minutes"] == 20
        assert f["early_leave_minutes"] == 30
        assert f["worked_hours"] == Decimal("7.000")
