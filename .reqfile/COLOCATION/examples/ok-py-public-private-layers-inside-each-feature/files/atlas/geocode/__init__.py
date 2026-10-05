from ._gazetteer import lookup

__all__ = ["geocode"]


def geocode(name: str) -> tuple[float, float]:
    """Return (latitude, longitude) for a known place name."""
    coords = lookup(name.strip().lower())
    if coords is None:
        raise KeyError(f"unknown place: {name}")
    return coords
