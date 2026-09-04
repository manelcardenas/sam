from datetime import UTC, datetime

from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Restaurant, RestaurantFilters, RestaurantSort
from src.domain.ports import DuplicateExternalPlaceError, RestaurantRepository
from src.infra.adapters.repos._score_sql import restaurant_average_overall
from src.infra.adapters.repos.ids import parse_uuid
from src.infra.db import CuisineModel, RestaurantModel, ReviewModel


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
            external_place_id=model.external_place_id,
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
                external_place_id=restaurant.external_place_id,
                created_by=restaurant.created_by,
                cuisines=self._resolve_cuisines(session, restaurant.cuisines),
            )
            session.add(model)
            try:
                session.commit()
            except IntegrityError as e:
                if "uq_restaurants_external_place_id" in str(e.orig):
                    raise DuplicateExternalPlaceError(restaurant.external_place_id) from e
                raise
            session.refresh(model)
            return self._to_entity(model)

    def find_by_external_place_id(self, external_place_id: str) -> Restaurant | None:
        with self._session_factory() as session:
            model = session.query(RestaurantModel).filter(RestaurantModel.external_place_id == external_place_id).one_or_none()
            if model is None:
                return None
            return self._to_entity(model)

    def get_restaurant(self, restaurant_id: str) -> Restaurant | None:
        uid = parse_uuid(restaurant_id)
        if uid is None:
            return None
        with self._session_factory() as session:
            model = session.get(RestaurantModel, uid)
            if model is None:
                return None
            return self._to_entity(model)

    def search_restaurants(self, filters: RestaurantFilters | None = None) -> list[Restaurant]:
        filters = filters or RestaurantFilters()
        with self._session_factory() as session:
            q = session.query(RestaurantModel)

            if filters.query:
                # Escape LIKE metacharacters so a user typing "100%" or "a_b" gets literal matches, not wildcards.
                escaped = filters.query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                q = q.filter(RestaurantModel.name.ilike(f"%{escaped}%", escape="\\"))

            if filters.cuisines:
                # any-of: a restaurant tagged Italian AND Mediterranean matches either chip.
                q = q.filter(RestaurantModel.cuisines.any(CuisineModel.name.in_(filters.cuisines)))

            if filters.price_levels:
                q = q.filter(RestaurantModel.price_level.in_(filters.price_levels))

            if filters.reviewed_by:
                q = q.filter(
                    exists().where(
                        ReviewModel.restaurant_id == RestaurantModel.id,
                        ReviewModel.user_id == filters.reviewed_by,
                    )
                )

            # Last visit per restaurant: drives the default ordering, and doubles as
            # the join target for the score filter. LEFT JOIN, because restaurants
            # with no reviews must stay findable — they sink to the bottom rather
            # than dropping out.
            visits = (
                select(
                    ReviewModel.restaurant_id.label("restaurant_id"),
                    func.max(ReviewModel.visited_at).label("last_visited_at"),
                    # Same expression the cards print (see _score_sql): already
                    # rounded to 1dp, so two places showing "8.0" compare equal
                    # under the rating sort and fall through to the tie-break.
                    restaurant_average_overall().label("average_overall"),
                    func.count(ReviewModel.id).label("review_count"),
                )
                .group_by(ReviewModel.restaurant_id)
                .subquery()
            )
            q = q.outerjoin(visits, visits.c.restaurant_id == RestaurantModel.id)

            if filters.min_score is not None:
                # An explicit score floor is a statement about quality, so unreviewed
                # restaurants (average NULL) are correctly excluded here.
                q = q.filter(visits.c.average_overall >= filters.min_score)

            if filters.sort is RestaurantSort.NAME:
                q = q.order_by(RestaurantModel.name)
            elif filters.sort is RestaurantSort.RATING:
                # NULLS LAST keeps unreviewed restaurants findable at the bottom
                # rather than dropping them or ranking them as zero — no score is
                # not a bad score.
                q = q.order_by(
                    visits.c.average_overall.desc().nullslast(),
                    visits.c.review_count.desc().nullslast(),
                    RestaurantModel.name,
                )
            else:
                q = q.order_by(visits.c.last_visited_at.desc().nullslast(), RestaurantModel.name)

            return [self._to_entity(m) for m in q.all()]

    def update_restaurant(self, restaurant: Restaurant) -> Restaurant:
        uid = parse_uuid(restaurant.id)
        if uid is None:
            raise KeyError(f"Restaurant with id {restaurant.id} not found")
        with self._session_factory() as session:
            model = session.get(RestaurantModel, uid)
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
