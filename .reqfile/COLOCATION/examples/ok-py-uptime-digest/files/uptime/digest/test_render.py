from uptime.digest import render


def test_render_lists_down_targets():
    out = render([{"url": "a", "up": True}, {"url": "b", "up": False}])
    assert out == "1 of 2 targets down:\n- b"
