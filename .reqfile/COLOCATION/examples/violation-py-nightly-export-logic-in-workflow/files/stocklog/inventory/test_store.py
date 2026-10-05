from stocklog.inventory import load_items


def test_every_item_has_a_sku_and_quantity():
    assert all({"sku", "quantity"} <= item.keys() for item in load_items())
