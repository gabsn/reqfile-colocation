import json
from pathlib import Path

DATA = Path(__file__).with_name("items.json")


def load_items() -> list[dict]:
    return json.loads(DATA.read_text())


def restock(sku: str, quantity: int) -> None:
    items = load_items()
    for item in items:
        if item["sku"] == sku:
            item["quantity"] += quantity
    DATA.write_text(json.dumps(items, indent=2) + "\n")
