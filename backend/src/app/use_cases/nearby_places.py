from src.domain.entities import Place
from src.domain.ports import PlacesProvider


class NearbyPlaces:
    def __init__(self, places_provider: PlacesProvider) -> None:
        self.places_provider = places_provider

    def execute(self, lat: float, lon: float, radius_m: int = 500) -> list[Place]:
        return self.places_provider.nearby(lat, lon, radius_m)
