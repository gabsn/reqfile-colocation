"""widget: fails when a Python file under the given folder leaves a TODO."""
import pathlib
import sys


def main() -> int:
    found = [
        f"{path}:{number}"
        for path in sorted(pathlib.Path(sys.argv[1]).rglob("*.py"))
        for number, line in enumerate(path.read_text().splitlines(), 1)
        if "TODO" in line
    ]
    print("\n".join(found))
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
