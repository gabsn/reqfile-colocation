import sys

from atlas import route


def main() -> None:
    origin, destination = sys.argv[1], sys.argv[2]
    print(f"{route(origin, destination):.1f} km")


if __name__ == "__main__":
    main()
