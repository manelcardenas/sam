from abc import ABC, abstractmethod

from src.domain.entities import Restaurant, RestaurantFilters


class DuplicateExternalPlaceError(Exception):
    """A Restaurant with this external_place_id already exists (partial unique index)."""


class RestaurantRepository(ABC):
    @abstractmethod
    def add_restaurant(self, restaurant: Restaurant) -> Restaurant:
        """Raises DuplicateExternalPlaceError if the restaurant's external_place_id is already taken."""
        pass

    @abstractmethod
    def find_by_external_place_id(self, external_place_id: str) -> Restaurant | None:
        pass

    @abstractmethod
    def get_restaurant(self, restaurant_id: str) -> Restaurant | None:
        pass

    @abstractmethod
    def search_restaurants(self, filters: RestaurantFilters | None = None) -> list[Restaurant]:
        """List restaurants narrowed and ordered by `filters` (used both for browsing and for create-time dedup)."""
        pass

    @abstractmethod
    def update_restaurant(self, restaurant: Restaurant) -> Restaurant:
        pass
