from billing import total


def monthly(nets: list[int]) -> int:
    return sum(total(n) for n in nets)


if __name__ == "__main__":
    print(monthly([100, 50]))
