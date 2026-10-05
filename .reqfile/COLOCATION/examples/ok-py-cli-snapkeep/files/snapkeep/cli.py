import argparse
import json
import sys

from snapkeep.restore import restore
from snapkeep.snapshot import take


def main(argv=None):
    parser = argparse.ArgumentParser(prog="snapkeep")
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot")
    snap.add_argument("root")
    rest = sub.add_parser("restore")
    rest.add_argument("file")
    rest.add_argument("target")
    args = parser.parse_args(argv)
    if args.command == "snapshot":
        json.dump(take(args.root), sys.stdout, indent=2)
    else:
        with open(args.file) as fh:
            restore(json.load(fh), args.target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
