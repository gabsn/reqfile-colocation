from crm.invoices.model import Invoice


def issue(invoice_id: str, customer_id: str, lines: list[int]) -> Invoice:
    return Invoice(invoice_id, customer_id, sum(lines))
