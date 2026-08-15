"""حساب المرتب — أرقام حد يقدر يراجعها بالورقة والقلم.

No session, no fixtures, no database: every case here is arithmetic somebody can check against a
published table. That matters more here than anywhere else in this codebase, because these figures
end up on a payslip an employee reads and in a ledger entry that cannot be edited afterwards.

Two of these go wrong quietly and expensively:

* **الضريبة تصاعدية، مش نسبة واحدة على الكل.** Applying the top band's rate to the whole amount is
  the classic mistake, and its shape is that a raise can leave somebody WORSE OFF. That is how it
  gets discovered — by an employee, angrily, after it has been wrong for months.
* **سقف الأجر التأميني.** Insurance is charged on a base clamped between a floor and a ceiling.
  Ignore the ceiling and every senior employee is over-deducted every month by an amount nobody
  notices until the authority reconciles.

No rates are written into the library or into this file. They are passed in, because they live in
`payroll_scheme_version` where the client's accountant maintains them.
"""
from __future__ import annotations

from decimal import Decimal

from src.lib.payroll_calc import (
    Bracket,
    absence_deduction,
    daily_rate,
    hourly_rate,
    insurance_for,
    net_of,
    overtime_amount,
    tax_for,
)

D = Decimal

# شرايح تجريبية بأرقام مستديرة عشان الحساب يتراجع بالراس — مش أرقام قانون.
BANDS = [
    Bracket(from_amount=D("0"), to_amount=D("10000"), rate_pct=D("0")),
    Bracket(from_amount=D("10000"), to_amount=D("30000"), rate_pct=D("10")),
    Bracket(from_amount=D("30000"), to_amount=D("60000"), rate_pct=D("20")),
    Bracket(from_amount=D("60000"), to_amount=None, rate_pct=D("25")),
]


class TestTax:
    def test_below_the_first_band_pays_nothing(self):
        assert tax_for(D("8000"), BANDS) == D("0.00")

    def test_only_the_excess_is_taxed(self):
        """٢٠ ألف: أول عشرة معفيين، والتانية بعشرة في المية = ١٠٠٠."""
        assert tax_for(D("20000"), BANDS) == D("1000.00")

    def test_each_slice_pays_its_own_band(self):
        """٥٠ ألف = ٠ + (٢٠ ألف × ١٠٪) + (٢٠ ألف × ٢٠٪) = ٢٠٠٠ + ٤٠٠٠ = ٦٠٠٠."""
        assert tax_for(D("50000"), BANDS) == D("6000.00")

    def test_the_open_top_band_takes_everything_above_it(self):
        """١٠٠ ألف = ٠ + ٢٠٠٠ + ٦٠٠٠ + (٤٠ ألف × ٢٥٪) = ١٨٠٠٠."""
        assert tax_for(D("100000"), BANDS) == D("18000.00")

    def test_a_raise_never_makes_somebody_worse_off(self):
        """أهم خاصية في الملف ده.

        Cross a band boundary by one pound and the tax must go up by pennies, not by thousands. If
        the top rate were applied to the whole amount, 30,001 would be taxed at 20% of everything —
        and the employee would take home less than at 30,000.
        """
        just_under = D("30000") - tax_for(D("30000"), BANDS)
        just_over = D("30001") - tax_for(D("30001"), BANDS)
        assert just_over > just_under, "زيادة جنيه خلّت الصافي أقل — الضريبة مش تصاعدية"

    def test_the_exemption_comes_off_first(self):
        # ٢٠ ألف بإعفاء ٥ آلاف = وعاء ١٥ ألف = ٥ آلاف في الشريحة التانية = ٥٠٠.
        assert tax_for(D("20000"), BANDS, exemption=D("5000")) == D("500.00")

    def test_an_exemption_bigger_than_the_income_is_not_a_refund(self):
        assert tax_for(D("3000"), BANDS, exemption=D("10000")) == D("0.00")

    def test_no_brackets_means_no_tax_not_a_crash(self):
        """الشرايح بتشحن فاضية لحد ما المحاسب يكتبها — والمسير لازم يشتغل قبلها."""
        assert tax_for(D("50000"), []) == D("0.00")

    def test_the_bands_are_read_in_order_whatever_order_they_arrive_in(self):
        assert tax_for(D("50000"), list(reversed(BANDS))) == D("6000.00")

    def test_a_fixed_amount_on_a_band_is_added(self):
        bands = [Bracket(from_amount=D("0"), to_amount=None, rate_pct=D("10"),
                         fixed_amount=D("50"))]
        assert tax_for(D("1000"), bands) == D("150.00")


class TestInsurance:
    def test_the_two_shares_are_worked_out_separately(self):
        emp, com = insurance_for(D("10000"), employee_pct=D("11"), employer_pct=D("18.75"))
        assert emp == D("1100.00")
        assert com == D("1875.00")

    def test_the_ceiling_caps_the_base(self):
        """راتب فوق السقف بيدفع على السقف — مش على اللي بياخده.

        Ignoring this over-deducts every senior employee every month.
        """
        emp, com = insurance_for(D("50000"), employee_pct=D("11"), employer_pct=D("18.75"),
                                 max_base=D("12600"))
        assert emp == D("1386.00")
        assert com == D("2362.50")

    def test_the_floor_lifts_the_base(self):
        emp, _ = insurance_for(D("1000"), employee_pct=D("11"), employer_pct=D("18.75"),
                               min_base=D("2000"))
        assert emp == D("220.00")

    def test_a_zero_base_costs_nothing(self):
        assert insurance_for(D("0"), employee_pct=D("11"), employer_pct=D("18.75")) == (
            D("0.00"), D("0.00"))


class TestRates:
    def test_the_daily_rate_uses_the_configured_month(self):
        """«الشهر تلاتين يوم» و«الشهر بأيامه» جوابين مختلفين، والاتنين مش غلط."""
        assert daily_rate(D("3000"), 30) == D("100.00")
        assert daily_rate(D("3100"), 31) == D("100.00")

    def test_a_zero_length_month_is_zero_not_a_crash(self):
        # إعداد حد كتبه غلط مايوقّعش المسير كله.
        assert daily_rate(D("3000"), 0) == D("0.00")

    def test_the_hourly_rate_follows_the_daily_one(self):
        assert hourly_rate(D("3000"), 30, 8) == D("12.50")

    def test_zero_hours_a_day_is_zero_not_a_crash(self):
        assert hourly_rate(D("3000"), 30, 0) == D("0.00")


class TestOvertime:
    def test_ordinary_overtime_is_paid_at_its_rate(self):
        assert overtime_amount(hours_normal=10, hourly=D("12.50"), normal_pct=D("135")) \
            == D("168.75")

    def test_holiday_overtime_is_paid_at_a_different_rate(self):
        """العطلة بنسبة أعلى — ده اللي القانون بيقوله، ومش نفس الرقم."""
        assert overtime_amount(hours_holiday=10, hourly=D("12.50"), holiday_pct=D("200")) \
            == D("250.00")

    def test_both_kinds_add_up(self):
        assert overtime_amount(hours_normal=10, hours_holiday=5, hourly=D("12.50"),
                               normal_pct=D("135"), holiday_pct=D("200")) == D("293.75")

    def test_no_overtime_is_zero(self):
        assert overtime_amount(hourly=D("12.50")) == D("0.00")


class TestDeductions:
    def test_absence_is_days_times_the_daily_rate(self):
        assert absence_deduction(days_absent=D("3"), daily=D("100")) == D("300.00")

    def test_negative_absence_is_not_a_bonus(self):
        assert absence_deduction(days_absent=D("-3"), daily=D("100")) == D("0.00")

    def test_the_net_is_the_gross_less_everything(self):
        assert net_of(gross=D("10000"), insurance_employee=D("1100"), tax=D("500"),
                      advances=D("400")) == D("8000.00")

    def test_a_negative_net_is_shown_not_hidden(self):
        """استقطاعات أكبر من المرتب حالة حقيقية — قسط سلفة كبير في شهر أجازة بدون أجر.

        Clamping it to zero would hide the case and quietly forgive the difference, and that is a
        decision the software does not get to make on the company's behalf.
        """
        assert net_of(gross=D("1000"), advances=D("1500")) == D("-500.00")
