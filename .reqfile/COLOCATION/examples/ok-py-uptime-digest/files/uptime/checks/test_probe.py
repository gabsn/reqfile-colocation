from uptime.checks import probe


def test_unreachable_is_down():
    assert probe("http://127.0.0.1:9/", timeout=0.2)["up"] is False
