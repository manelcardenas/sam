import logging
import os

import sqlalchemy
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.infra.observability import install_engine_instrumentation
from src.infra.ssm import read_secure_parameter

logger = logging.getLogger(__name__)

# Held open between invocations, so a warm container reuses one socket instead
# of re-doing TCP+TLS+auth. One per container is plenty: a Lambda container
# serves one request at a time. The overflow slot exists only so a stray
# concurrent checkout blocks briefly rather than erroring.
_POOL_SIZE = 1
_MAX_OVERFLOW = 1
_POOL_RECYCLE_SECONDS = 280


def build_dsn() -> str:
    """Build a synchronous PostgreSQL DSN. Uses psycopg2 (sync driver).

    Resolution order:
      1. POSTGRES_DSN — a complete DSN (Neon-friendly). Used locally via .env.
      2. POSTGRES_DSN_PARAM — name of an SSM SecureString holding the DSN.
         CloudFormation can't inject an ssm-secure value into a Lambda env var,
         so on Lambda we pass the parameter *name* and fetch+decrypt it here at
         cold start.
      3. Legacy 5-field POSTGRES_* config (local Docker Postgres; see
         docker-compose.yml).
    """
    dsn = os.environ.get("POSTGRES_DSN")
    if dsn:
        return dsn

    param_name = os.environ.get("POSTGRES_DSN_PARAM")
    if param_name:
        # Batched with the Geoapify key — see src/infra/ssm.py. Unlike that
        # key, a missing DSN is fatal: there is no app without a database.
        dsn = read_secure_parameter(param_name)
        if not dsn:
            raise RuntimeError(f"SSM parameter {param_name} holds no value")
        return dsn

    host = os.environ["POSTGRES_HOST"]
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ["POSTGRES_DB"]
    user = os.environ["POSTGRES_USER"]
    password = os.environ["POSTGRES_PASSWORD"]
    sslmode = os.environ.get("POSTGRES_SSLMODE", "")
    suffix = f"?sslmode={sslmode}" if sslmode else ""
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}{suffix}"


class DatabaseConnectionPool:
    """Manages the synchronous SQLAlchemy engine and session factory.

    Pools connections rather than using NullPool. The engine is built at module
    scope, so a warm Lambda container reuses the same socket across
    invocations: GET /restaurants went from three cross-region handshakes to
    roughly zero. `pool_pre_ping` covers the two ways a pooled socket can die —
    a frozen container and Neon's scale-to-zero — by testing liveness and
    transparently reconnecting.

    See docs/adr/0006-pooled-connections-on-lambda.md for why the usual
    NullPool-on-Lambda advice does not apply to this deployment, and for the
    verification that holding a connection does not keep Neon's compute awake
    (it doesn't, so this costs nothing).

    The open()/close() methods follow the same lifecycle pattern as the ECS
    reference project, called once per process via the FastAPI lifespan.
    On Lambda this means once per cold start.
    """

    def __init__(self, dsn: str) -> None:
        logger.info("Initialising database connection pool")
        self._engine = create_engine(
            dsn,
            pool_size=_POOL_SIZE,
            max_overflow=_MAX_OVERFLOW,
            pool_pre_ping=True,
            pool_recycle=_POOL_RECYCLE_SECONDS,
        )
        # Counts Handshakes and query time per request, read by
        # RequestTimingMiddleware. Measurement only — no behaviour change.
        install_engine_instrumentation(self._engine)
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

        Now that connections are pooled this also *pre-warms*: the connection
        opened here returns to the pool, so the first real request inherits it
        instead of paying a handshake. Under NullPool it was pure overhead.
        """
        logger.info("Testing database connection...")
        with self._engine.connect() as conn:
            conn.execute(sqlalchemy.text("SELECT 1"))
        logger.info("Database connection verified")

    def close(self) -> None:
        """Dispose the engine on application shutdown.

        Now meaningful: it closes the pooled connections rather than merely
        tidying internal state, so a clean shutdown doesn't leave sockets for
        the server to time out.
        """
        self._engine.dispose()
        logger.info("Database connection pool closed")
