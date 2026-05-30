from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from src.domain.entities import User
from src.domain.errors import DisplayNameTakenError
from src.domain.ports import UserRepository
from src.infra.db import UserModel


class PostgresUserRepository(UserRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @staticmethod
    def _to_entity(model: UserModel) -> User:
        return User(
            id=model.id,
            display_name=model.display_name,
            email=model.email,
            created_at=model.created_at.isoformat(),
            updated_at=model.updated_at.isoformat(),
        )

    def ensure_user(self, user_id: str, email: str) -> None:
        # Provision the row with no display_name — NULL is the "needs to choose"
        # signal. No collision handling needed: UNIQUE permits many NULLs.
        with self._session_factory() as session:
            stmt = insert(UserModel).values(id=user_id, email=email).on_conflict_do_nothing(index_elements=["id"])
            session.execute(stmt)
            session.commit()

    def get_by_id(self, user_id: str) -> User | None:
        with self._session_factory() as session:
            model = session.get(UserModel, user_id)
            if model is None:
                return None
            return self._to_entity(model)

    def update_display_name(self, user_id: str, new_name: str) -> User:
        with self._session_factory() as session:
            model = session.get(UserModel, user_id)
            if model is None:
                raise KeyError(f"User with id {user_id} not found")
            model.display_name = new_name
            try:
                session.commit()
            except IntegrityError as e:
                # display_name is UNIQUE — someone else already owns this name.
                session.rollback()
                raise DisplayNameTakenError(new_name) from e
            session.refresh(model)
            return self._to_entity(model)
