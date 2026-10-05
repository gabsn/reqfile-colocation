import json
import os

from uptime.checks import probe


def collect(targets_file=None):
    path = targets_file or os.environ.get("UPTIME_TARGETS", "targets.json")
    with open(path) as fh:
        targets = json.load(fh)
    return [probe(url) for url in targets]
