from src.domain.entities import Restaurant
from src.domain.ports import DuplicateExternalPlaceError, RestaurantRepository


class CreateRestaurant:
    def __init__(self, restaurant_repository: RestaurantRepository) -> None:
        self.restaurant_repository = restaurant_repository

    def execute(self, restaurant: Restaurant) -> tuple[Restaurant, bool]:
        """Create a restaurant; returns (restaurant, created).

        Idempotent on external_place_id: picking a Place that's already on SAM
        returns the existing Restaurant instead of failing or duplicating. The
        partial unique index makes this race-proof — on a concurrent create the
        loser lands in the except branch and returns the winner's row.
        """
        try:
            return self.restaurant_repository.add_restaurant(restaurant), True
        except DuplicateExternalPlaceError:
            assert restaurant.external_place_id is not None  # the index only covers non-NULL ids
            existing = self.restaurant_repository.find_by_external_place_id(restaurant.external_place_id)
            if existing is None:
                # Vanishingly unlikely (row deleted between conflict and lookup) — surface the original conflict.
                raise
            return existing, False
