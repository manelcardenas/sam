from datetime import UTC, datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Aisle, GroceryItem, GrocerySource
from src.domain.ports import GroceryRepository
from src.infra.db import GroceryItemModel


def _to_entity(model: GroceryItemModel) -> GroceryItem:
    return GroceryItem(
        key=model.key,
        name_es=model.name_es,
        name_ca=model.name_ca,
        name_en=model.name_en,
        aisle=Aisle(model.aisle),
        is_pantry=model.is_pantry,
        default_unit=model.default_unit,
        source=GrocerySource(model.source),
        confirmed_at=model.confirmed_at.isoformat() if model.confirmed_at else None,
        created_at=model.created_at.isoformat(),
    )


class PostgresGroceryRepository(GroceryRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_all(self) -> list[GroceryItem]:
        with self._session_factory() as session:
            models = session.query(GroceryItemModel).order_by(GroceryItemModel.key).all()
            return [_to_entity(m) for m in models]

    def get(self, key: str) -> GroceryItem | None:
        with self._session_factory() as session:
            model = session.get(GroceryItemModel, key)
            return _to_entity(model) if model else None

    def set_aisle(self, key: str, aisle: Aisle) -> GroceryItem | None:
        with self._session_factory() as session:
            model = session.get(GroceryItemModel, key)
            if model is None:
                return None
            model.aisle = aisle
            model.confirmed_at = datetime.now(UTC)
            session.commit()
            session.refresh(model)
            return _to_entity(model)

    def update(self, item: GroceryItem) -> GroceryItem | None:
        with self._session_factory() as session:
            model = session.get(GroceryItemModel, item.key)
            if model is None:
                return None
            model.name_es = item.name_es
            model.name_ca = item.name_ca
            model.name_en = item.name_en
            model.aisle = item.aisle
            model.is_pantry = item.is_pantry
            model.default_unit = item.default_unit
            model.confirmed_at = datetime.fromisoformat(item.confirmed_at) if item.confirmed_at else None
            session.commit()
            session.refresh(model)
            return _to_entity(model)

    def delete(self, key: str) -> bool:
        with self._session_factory() as session:
            model = session.get(GroceryItemModel, key)
            if model is None:
                return False
            session.delete(model)
            session.commit()
            return True

    def upsert_many(self, items: list[GroceryItem]) -> int:
        if not items:
            return 0

        with self._session_factory() as session:
            statement = insert(GroceryItemModel).values(
                [
                    {
                        "key": item.key,
                        "name_es": item.name_es,
                        "name_ca": item.name_ca,
                        "name_en": item.name_en,
                        "aisle": item.aisle.value,
                        "is_pantry": item.is_pantry,
                        "default_unit": item.default_unit,
                        "source": item.source.value,
                        "confirmed_at": datetime.fromisoformat(item.confirmed_at) if item.confirmed_at else None,
                    }
                    for item in items
                ]
            )
            # ON CONFLICT rather than a read-then-write loop: the seed is a few
            # hundred rows and this is one round trip, but more importantly it
            # is atomic, so a half-applied seed is not a state that exists.
            #
            # `created_at` and `confirmed_at` are **absent from the update set on
            # purpose** — re-running the seed must not backdate a row somebody
            # created by hand, nor erase the fact that a person vouched for one.
            session.execute(
                statement.on_conflict_do_update(
                    index_elements=[GroceryItemModel.key],
                    set_={
                        "name_es": statement.excluded.name_es,
                        "name_ca": statement.excluded.name_ca,
                        "name_en": statement.excluded.name_en,
                        "aisle": statement.excluded.aisle,
                        "is_pantry": statement.excluded.is_pantry,
                        "default_unit": statement.excluded.default_unit,
                        "source": statement.excluded.source,
                    },
                    # A confirmed row is left exactly as a person left it. The
                    # seed runs on every deploy, so without this an edit — an
                    # aisle, a name — would last until the next push.
                    where=GroceryItemModel.confirmed_at.is_(None),
                )
            )
            session.commit()
            return len(items)
