#!/usr/bin/env bash
# Compares widget's score on the private corpus with the base branch.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
python3 "$here/score.py" "$1"
