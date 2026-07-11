from abc import ABC, abstractmethod

from src.domain.entities import Restaurant


class RestaurantRepository(ABC):
    @abstractmethod
    def add_restaurant(self, restaurant: Restaurant) -> Restaurant:
        pass

    @abstractmethod
    def get_restaurant(self, restaurant_id: str) -> Restaurant | None:
        pass

    @abstractmethod
    def search_restaurants(self, query: str | None = None) -> list[Restaurant]:
        """List restaurants, optionally filtered by a case-insensitive name match (used both for browsing and for create-time dedup)."""
        pass

    @abstractmethod
    def update_restaurant(self, restaurant: Restaurant) -> Restaurant:
        pass
