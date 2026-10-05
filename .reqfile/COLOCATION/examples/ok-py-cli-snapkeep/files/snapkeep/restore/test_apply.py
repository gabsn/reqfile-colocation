from snapkeep.restore import restore


def test_restore_writes_files(tmp_path):
    restore({"files": {"d/b.txt": "x"}}, str(tmp_path))
    assert (tmp_path / "d" / "b.txt").read_text() == "x"
