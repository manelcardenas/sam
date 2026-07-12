from src.domain.entities import Area, Place
from src.domain.ports import PlacesProvider


class InMemoryPlacesProvider(PlacesProvider):
    """In-memory provider for unit tests only. Seed it with Places/Areas; search
    matches case-insensitively on name, nearby returns everything seeded."""

    def __init__(self, places: list[Place] | None = None, areas: list[Area] | None = None) -> None:
        self.places = places or []
        self.areas = areas or []

    def search(self, text: str, bias_lat: float | None = None, bias_lon: float | None = None) -> list[Place]:  # noqa: ARG002 — bias is irrelevant in-memory
        text_lower = text.lower()
        return [p.model_copy() for p in self.places if text_lower in p.name.lower()]

    def nearby(self, lat: float, lon: float, radius_m: int = 500) -> list[Place]:  # noqa: ARG002 — location is irrelevant in-memory
        return [p.model_copy() for p in self.places]

    def search_areas(self, text: str) -> list[Area]:
        text_lower = text.lower()
        return [a.model_copy() for a in self.areas if text_lower in a.name.lower()]
