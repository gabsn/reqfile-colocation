from atlas.geocode import geocode

from ._haversine import distance_km

__all__ = ["route"]


def route(origin: str, destination: str) -> float:
    """Great-circle distance in km between two named places."""
    return distance_km(geocode(origin), geocode(destination))
