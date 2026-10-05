"""Scores widget on the private corpus."""
import json
import sys


def main() -> None:
    cases = json.load(open(sys.argv[1]))
    print(sum(case["passed"] for case in cases) / len(cases))


if __name__ == "__main__":
    main()
