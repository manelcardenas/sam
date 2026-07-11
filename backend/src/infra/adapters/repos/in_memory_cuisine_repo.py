from src.domain.entities import Cuisine
from src.domain.ports import CuisineRepository


class InMemoryCuisineRepository(CuisineRepository):
    """In-memory repository for unit tests only. Not used in production."""

    def __init__(self, cuisines: list[Cuisine] | None = None) -> None:
        self.cuisines = cuisines if cuisines is not None else []

    def list_cuisines(self) -> list[Cuisine]:
        return list(self.cuisines)
