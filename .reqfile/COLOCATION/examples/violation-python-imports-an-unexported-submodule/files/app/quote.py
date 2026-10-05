from billing import tax
from billing import total


def quote(net: int) -> str:
    return f"{tax.rate(net)} of {total(net)}"


if __name__ == "__main__":
    print(quote(100))
