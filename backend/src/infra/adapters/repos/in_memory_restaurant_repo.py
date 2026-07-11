from datetime import UTC, datetime

from src.domain.entities import Restaurant
from src.domain.ports import DuplicateExternalPlaceError, RestaurantRepository


class InMemoryRestaurantRepository(RestaurantRepository):
    """In-memory repository for unit tests only.

    Not used in production. Allows use-case tests to run without
    any database or Docker dependency.
    """

    def __init__(self) -> None:
        self.table: dict[str, dict] = {}

    def add_restaurant(self, restaurant: Restaurant) -> Restaurant:
        # Simulates the partial unique index on external_place_id.
        if restaurant.external_place_id is not None and self.find_by_external_place_id(restaurant.external_place_id) is not None:
            raise DuplicateExternalPlaceError(restaurant.external_place_id)
        self.table[restaurant.id] = restaurant.model_dump()
        return Restaurant(**self.table[restaurant.id])  # New instance each time. Prevents accidental mutations of the in-memory dict.

    def find_by_external_place_id(self, external_place_id: str) -> Restaurant | None:
        for data in self.table.values():
            if data["external_place_id"] == external_place_id:
                return Restaurant(**data)
        return None

    def get_restaurant(self, restaurant_id: str) -> Restaurant | None:
        data = self.table.get(restaurant_id)
        if data is None:
            return None
        return Restaurant(**data)

    def search_restaurants(self, query: str | None = None) -> list[Restaurant]:
        restaurants = [Restaurant(**data) for data in self.table.values()]
        if query:
            query_lower = query.lower()
            restaurants = [r for r in restaurants if query_lower in r.name.lower()]
        return restaurants

    def update_restaurant(self, restaurant: Restaurant) -> Restaurant:
        if restaurant.id not in self.table:
            raise KeyError(f"Restaurant with id {restaurant.id} not found")

        data = restaurant.model_dump()
        data["updated_at"] = datetime.now(UTC).isoformat()
        self.table[restaurant.id] = data

        return Restaurant(**self.table[restaurant.id])
