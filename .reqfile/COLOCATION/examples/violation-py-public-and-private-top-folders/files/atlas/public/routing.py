from atlas.private.haversine import distance_km
from atlas.public.geocode import geocode


def route(origin: str, destination: str) -> float:
    """Great-circle distance in km between two named places."""
    return distance_km(geocode(origin), geocode(destination))
