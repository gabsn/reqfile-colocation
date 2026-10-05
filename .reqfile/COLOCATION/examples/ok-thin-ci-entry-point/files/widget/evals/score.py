"""Share of passed cases in widget's JSON-lines output."""
import json
import sys


def main() -> None:
    with open(sys.argv[1]) as results:
        cases = [json.loads(line) for line in results]
    print(sum(case["passed"] for case in cases) / len(cases))


if __name__ == "__main__":
    main()
