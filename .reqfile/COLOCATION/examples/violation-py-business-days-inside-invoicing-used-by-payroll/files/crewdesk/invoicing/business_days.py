from datetime import date, timedelta

HOLIDAYS = {date(2026, 12, 25), date(2027, 1, 1)}


def is_business_day(day: date) -> bool:
    return day.weekday() < 5 and day not in HOLIDAYS


def add_business_days(start: date, days: int) -> date:
    day = start
    while days > 0:
        day += timedelta(days=1)
        if is_business_day(day):
            days -= 1
    return day
