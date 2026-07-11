from src.domain.entities import Cuisine
from src.domain.ports import CuisineRepository


class ListCuisines:
    def __init__(self, cuisine_repository: CuisineRepository) -> None:
        self.cuisine_repository = cuisine_repository

    def execute(self) -> list[Cuisine]:
        return self.cuisine_repository.list_cuisines()
