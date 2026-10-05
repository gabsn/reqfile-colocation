import argparse
import sys

from stocklog.export import low_stock_csv
from stocklog.inventory import load_items

parser = argparse.ArgumentParser(prog="python -m stocklog.export")
parser.add_argument("--threshold", type=int, default=5)
args = parser.parse_args()
sys.stdout.write(low_stock_csv(load_items(), args.threshold))
