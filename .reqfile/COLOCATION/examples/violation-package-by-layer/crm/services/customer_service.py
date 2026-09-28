from crm.models.customer import Customer


def register(customer_id: str, email: str) -> Customer:
    return Customer(customer_id, email.strip().lower())
