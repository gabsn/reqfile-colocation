import json

from uptime.digest import collect


def test_collect_reads_targets(tmp_path):
    f = tmp_path / "t.json"
    f.write_text(json.dumps(["http://127.0.0.1:9/"]))
    assert collect(str(f)) == [{"url": "http://127.0.0.1:9/", "up": False}]
