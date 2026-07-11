from abc import ABC, abstractmethod

from src.domain.entities import Cuisine


class CuisineRepository(ABC):
    @abstractmethod
    def list_cuisines(self) -> list[Cuisine]:
        pass
