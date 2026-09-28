from crm.models.customer import Customer


def find_customer(db: dict[str, Customer], customer_id: str) -> Customer:
    return db[customer_id]
