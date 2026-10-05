import urllib.request


def probe(url, timeout=5.0):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return {"url": url, "up": 200 <= resp.status < 400}
    except OSError:
        return {"url": url, "up": False}
