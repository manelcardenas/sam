"""Per-request database metrics, collected via SQLAlchemy engine events.

Exists to answer two questions the CloudWatch `REPORT` line cannot:
which route is slow, and how much of that is the database. See
`docs/plans/routing-and-latency-plan.md` §7 step 0.

The counters live in a ContextVar holding a *mutable* object. That detail is
load-bearing: FastAPI runs this codebase's sync (`def`) endpoints in a
threadpool, and both anyio's task spawning and its thread dispatch *copy* the
context rather than share it. A `ContextVar.set()` from inside the endpoint
would be invisible to the middleware; mutating an object the copied context
already points at is visible everywhere.
"""

import time
from contextvars import ContextVar
from dataclasses import dataclass

from sqlalchemy import event
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.engine.interfaces import DBAPIConnection, DBAPICursor, Dialect, ExecutionContext
from sqlalchemy.pool import ConnectionPoolEntry


@dataclass
class DbMetrics:
    """What one request cost the database."""

    connects: int = 0  # real physical connections opened — i.e. Handshakes
    connect_ms: float = 0.0  # time spent in those Handshakes
    queries: int = 0
    ms: float = 0.0  # time spent executing statements, excluding Handshakes


_db_metrics: ContextVar[DbMetrics | None] = ContextVar("sam_db_metrics", default=None)


def start_db_metrics() -> DbMetrics:
    """Begin collecting for a new request. Call before dispatching downstream."""
    metrics = DbMetrics()
    _db_metrics.set(metrics)
    return metrics


def current_db_metrics() -> DbMetrics | None:
    """The in-flight request's counters, or None outside a request (seeding, CLI)."""
    return _db_metrics.get()


def install_engine_instrumentation(engine: Engine) -> None:
    """Attach the counters to an engine. Idempotent per engine instance."""

    @event.listens_for(engine, "do_connect")
    def _before_connect(_dialect: Dialect, connection_record: ConnectionPoolEntry, _cargs: tuple, _cparams: dict) -> None:
        # Returning None means "connect normally" — this hook exists purely to
        # start the clock, because the `connect` event below fires only *after*
        # the handshake and so cannot time it. Stashed on the pool entry, which
        # is the same object both events receive.
        connection_record._sam_connect_started = time.perf_counter()  # type: ignore[attr-defined]
        return None

    @event.listens_for(engine, "connect")
    def _on_connect(_dbapi_connection: DBAPIConnection, connection_record: ConnectionPoolEntry) -> None:
        # Fires only for a genuinely new DBAPI connection, never for a pool
        # checkout — which is exactly the number that should fall to ~0 once
        # ADR-0006's pooling lands, and the assertion that it actually did.
        metrics = current_db_metrics()
        if metrics is None:
            return
        metrics.connects += 1
        started = getattr(connection_record, "_sam_connect_started", None)
        if started is not None:
            # The cross-region TCP+TLS+auth cost the whole plan is about.
            metrics.connect_ms += (time.perf_counter() - started) * 1000

    @event.listens_for(engine, "before_cursor_execute")
    def _before_cursor_execute(
        _conn: Connection,
        _cursor: DBAPICursor,
        _statement: str,
        _parameters: object,
        context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        # Stashed on the execution context so concurrent statements can't
        # overwrite each other's start time.
        context._sam_started = time.perf_counter()  # type: ignore[attr-defined]

    @event.listens_for(engine, "after_cursor_execute")
    def _after_cursor_execute(
        _conn: Connection,
        _cursor: DBAPICursor,
        _statement: str,
        _parameters: object,
        context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        started = getattr(context, "_sam_started", None)
        metrics = current_db_metrics()
        if started is None or metrics is None:
            return
        metrics.queries += 1
        metrics.ms += (time.perf_counter() - started) * 1000
