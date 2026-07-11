from src.domain.entities import Place
from src.domain.ports import PlacesProvider


class SearchPlaces:
    def __init__(self, places_provider: PlacesProvider) -> None:
        self.places_provider = places_provider

    def execute(self, text: str, bias_lat: float | None = None, bias_lon: float | None = None) -> list[Place]:
        return self.places_provider.search(text, bias_lat, bias_lon)
