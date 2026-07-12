from src.domain.entities import Area
from src.domain.ports import PlacesProvider


class SearchAreas:
    def __init__(self, places_provider: PlacesProvider) -> None:
        self.places_provider = places_provider

    def execute(self, text: str) -> list[Area]:
        return self.places_provider.search_areas(text)
