from crm.models.invoice import Invoice


def save_invoice(db: dict[str, Invoice], invoice: Invoice) -> None:
    db[invoice.id] = invoice
