from dataclasses import dataclass


@dataclass(frozen=True)
class Invoice:
    id: str
    customer_id: str
    total_cents: int
