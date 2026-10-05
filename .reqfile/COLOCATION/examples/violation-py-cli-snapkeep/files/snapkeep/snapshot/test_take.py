from snapkeep.snapshot import take


def test_take_lists_every_file(tmp_path):
    (tmp_path / "a.txt").write_text("hello")
    snap = take(str(tmp_path))
    assert snap["files"] == {"a.txt": "hello"}
    assert snap["manifest"]["count"] == 1
