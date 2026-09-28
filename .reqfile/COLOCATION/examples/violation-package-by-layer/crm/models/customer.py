from dataclasses import dataclass


@dataclass(frozen=True)
class Customer:
    id: str
    email: str
