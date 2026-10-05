from datetime import date

from crewdesk.payroll import pay_date


def test_pay_date_falls_back_from_a_weekend():
    assert pay_date(2026, 10) == date(2026, 10, 30)
