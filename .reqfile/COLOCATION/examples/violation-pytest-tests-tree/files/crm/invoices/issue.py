def issue_invoice(customer_id: str, cents: int) -> dict:
    return {"customer": customer_id, "cents": cents, "status": "issued"}
