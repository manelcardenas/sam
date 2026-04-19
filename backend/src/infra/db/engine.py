import logging
import os

import sqlalchemy
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

logger = logging.getLogger(__name__)


def build_dsn() -> str:
    """Build a synchronous PostgreSQL DSN from environment variables.

    Uses psycopg2 (sync driver). Both local and Lambda environments set
    these variables — locally via .env, on Lambda via the function config.
    """
    host = os.environ["POSTGRES_HOST"]
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ["POSTGRES_DB"]
    user = os.environ["POSTGRES_USER"]
    password = os.environ["POSTGRES_PASSWORD"]
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"


class DatabaseConnectionPool:
    """Manages the synchronous SQLAlchemy engine and session factory.

    Uses NullPool for Lambda: connections are never held between requests,
    preventing connection leaks across invocations. Each DB call opens a
    fresh connection and closes it immediately after — safe and correct for
    short-lived Lambda executions.

    The open()/close() methods follow the same lifecycle pattern as the ECS
    reference project, called once per process via the FastAPI lifespan.
    On Lambda this means once per cold start.
    """

    def __init__(self, dsn: str) -> None:
        logger.info("Initialising database connection pool")
        self._engine = create_engine(dsn, poolclass=NullPool)
        self._session_factory: sessionmaker[Session] = sessionmaker(
            self._engine,
            expire_on_commit=False,
        )

    @property
    def session_factory(self) -> sessionmaker[Session]:
        """Returns the session factory used by all repository adapters."""
        return self._session_factory

    def open(self) -> None:
        """Test the connection on application startup.

        Fails fast if credentials are wrong or the DB is unreachable.
        Called once per Lambda cold start via the FastAPI lifespan.
        """
        logger.info("Testing database connection...")
        with self._engine.connect() as conn:
            conn.execute(sqlalchemy.text("SELECT 1"))
        logger.info("Database connection verified")

    def close(self) -> None:
        """Dispose the engine on application shutdown.

        With NullPool there are no idle connections to release, but this
        ensures any internal SQLAlchemy state is cleaned up correctly.
        """
        self._engine.dispose()
        logger.info("Database connection pool closed")
