_PLACES = {
    "paris": (48.8566, 2.3522),
    "lyon": (45.7640, 4.8357),
    "lille": (50.6292, 3.0573),
}


def lookup(key: str) -> tuple[float, float] | None:
    return _PLACES.get(key)
