from src.domain.ports import PlacesProvider


class ReverseGeocode:
    def __init__(self, places_provider: PlacesProvider) -> None:
        self.places_provider = places_provider

    def execute(self, lat: float, lon: float) -> str | None:
        return self.places_provider.reverse_geocode(lat, lon)
