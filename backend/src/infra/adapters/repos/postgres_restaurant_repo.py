import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Restaurant
from src.domain.ports import RestaurantRepository
from src.infra.db import CuisineModel, RestaurantModel


class PostgresRestaurantRepository(RestaurantRepository):
    """PostgreSQL-backed implementation of RestaurantRepository.

    Uses a synchronous SQLAlchemy session per operation with NullPool,
    which is the correct pattern for Lambda: each call opens a fresh
    connection and closes it immediately, avoiding connection leaks.
    """

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def _to_entity(self, model: RestaurantModel) -> Restaurant:
        return Restaurant(
            id=str(model.id),
            name=model.name,
            address=model.address,
            price_level=model.price_level,
            latitude=model.latitude,
            longitude=model.longitude,
            cuisines=[c.name for c in model.cuisines],
            created_by=model.created_by,
            created_by_name=model.creator.display_name if model.creator else None,
            created_at=model.created_at.isoformat(),
            updated_at=model.updated_at.isoformat(),
        )

    def _resolve_cuisines(self, session: Session, names: list[str]) -> list[CuisineModel]:
        if not names:
            return []
        return session.query(CuisineModel).filter(CuisineModel.name.in_(names)).all()

    def add_restaurant(self, restaurant: Restaurant) -> Restaurant:
        with self._session_factory() as session:
            model = RestaurantModel(
                name=restaurant.name,
                address=restaurant.address,
                price_level=restaurant.price_level,
                latitude=restaurant.latitude,
                longitude=restaurant.longitude,
                created_by=restaurant.created_by,
                cuisines=self._resolve_cuisines(session, restaurant.cuisines),
            )
            session.add(model)
            session.commit()
            session.refresh(model)
            return self._to_entity(model)

    def get_restaurant(self, restaurant_id: str) -> Restaurant | None:
        with self._session_factory() as session:
            model = session.get(RestaurantModel, uuid.UUID(restaurant_id))
            if model is None:
                return None
            return self._to_entity(model)

    def search_restaurants(self, query: str | None = None) -> list[Restaurant]:
        with self._session_factory() as session:
            q = session.query(RestaurantModel)
            if query:
                q = q.filter(RestaurantModel.name.ilike(f"%{query}%"))
            models = q.order_by(RestaurantModel.name).all()
            return [self._to_entity(m) for m in models]

    def update_restaurant(self, restaurant: Restaurant) -> Restaurant:
        with self._session_factory() as session:
            model = session.get(RestaurantModel, uuid.UUID(restaurant.id))
            if model is None:
                raise KeyError(f"Restaurant with id {restaurant.id} not found")
            model.name = restaurant.name
            model.address = restaurant.address
            model.price_level = restaurant.price_level
            model.latitude = restaurant.latitude
            model.longitude = restaurant.longitude
            model.cuisines = self._resolve_cuisines(session, restaurant.cuisines)
            model.updated_at = datetime.now(UTC)
            session.commit()
            session.refresh(model)
            return self._to_entity(model)
