from datetime import date

from .business_days import add_business_days

PAYMENT_TERMS_BUSINESS_DAYS = 10


def due_date(issued: date) -> date:
    return add_business_days(issued, PAYMENT_TERMS_BUSINESS_DAYS)
