from billing.tax import rate


def total(net: int) -> int:
    return net + rate(net)
