from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import Cuisine
from src.domain.ports import CuisineRepository
from src.infra.db import CuisineModel


class PostgresCuisineRepository(CuisineRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_cuisines(self) -> list[Cuisine]:
        with self._session_factory() as session:
            models = session.query(CuisineModel).order_by(CuisineModel.name).all()
            return [Cuisine(id=str(m.id), name=m.name) for m in models]
