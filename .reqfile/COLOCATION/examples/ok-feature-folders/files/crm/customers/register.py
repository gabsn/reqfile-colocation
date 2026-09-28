from crm.customers.model import Customer


def register(customer_id: str, email: str) -> Customer:
    return Customer(customer_id, email.strip().lower())
