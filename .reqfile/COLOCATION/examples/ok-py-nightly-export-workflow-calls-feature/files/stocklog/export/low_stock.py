import csv
import io


def low_stock_csv(items: list[dict], threshold: int) -> str:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["sku", "name", "quantity"])
    for item in sorted(items, key=lambda i: i["quantity"]):
        if item["quantity"] < threshold:
            writer.writerow([item["sku"], item["name"], item["quantity"]])
    return out.getvalue()
