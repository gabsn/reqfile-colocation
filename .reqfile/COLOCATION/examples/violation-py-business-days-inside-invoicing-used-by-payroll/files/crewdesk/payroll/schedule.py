import calendar
from datetime import date, timedelta

from crewdesk.invoicing import is_business_day


def pay_date(year: int, month: int) -> date:
    """Salaries are paid on the last business day of the month."""
    day = date(year, month, calendar.monthrange(year, month)[1])
    while not is_business_day(day):
        day -= timedelta(days=1)
    return day
