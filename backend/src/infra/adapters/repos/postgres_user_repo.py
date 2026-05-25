from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from src.domain.ports import UserRepository
from src.infra.db import UserModel


class PostgresUserRepository(UserRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def ensure_user(self, user_id: str, email: str) -> None:
        display_name = email.split("@", 1)[0]

        with self._session_factory() as session:
            try:
                self._insert(session, user_id, email, display_name)
            except IntegrityError:
                # display_name is UNIQUE — another account already owns this
                # prefix. Disambiguate with a short slice of the sub.
                session.rollback()
                self._insert(session, user_id, email, f"{display_name}_{user_id[:6]}")

    @staticmethod
    def _insert(session: Session, user_id: str, email: str, display_name: str) -> None:
        stmt = insert(UserModel).values(id=user_id, email=email, display_name=display_name).on_conflict_do_nothing(index_elements=["id"])
        session.execute(stmt)
        session.commit()
