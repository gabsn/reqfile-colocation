from datetime import date

from crewdesk.invoicing import due_date


def test_due_date_skips_christmas_and_weekends():
    assert due_date(date(2026, 12, 18)) == date(2027, 1, 5)
