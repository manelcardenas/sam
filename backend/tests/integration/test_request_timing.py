"""Tests for the request-timing middleware (routing-and-latency-plan.md §7 step 0).

The interesting risk here is not the arithmetic, it's context propagation: this
codebase's endpoints are sync (`def`), so FastAPI runs them in a threadpool.
anyio *copies* the context into both the child task and the worker thread, so
counters recorded down there are only visible to the middleware because they
mutate a shared object rather than re-set the ContextVar. If that ever
regresses, `db_connects` silently reports 0 and every later step in the plan
becomes unmeasurable — hence a test that drives a real engine through a real
sync endpoint.
"""

import json

import sqlalchemy
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool, StaticPool
from starlette.testclient import TestClient

from src.infra.middleware import RequestTimingMiddleware
from src.infra.observability import install_engine_instrumentation


def _lines(capsys) -> list[dict]:  # noqa: ANN001
    out = capsys.readouterr().out
    return [json.loads(line) for line in out.splitlines() if line.startswith('{"evt": "req"')]


def _app(engine: sqlalchemy.Engine | None = None) -> FastAPI:
    app = FastAPI()

    # Sync `def` on purpose — this is what the real controllers use, and it's
    # what forces the threadpool hop the docstring is about.
    @app.get("/things/{thing_id}")
    def get_thing(thing_id: str) -> dict[str, str]:
        if engine is not None:
            with engine.connect() as conn:
                conn.execute(sqlalchemy.text("SELECT 1"))
                conn.execute(sqlalchemy.text("SELECT 2"))
        return {"id": thing_id}

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("kaboom")

    app.add_middleware(RequestTimingMiddleware)
    return app


def test_logs_one_line_per_request_with_the_route_template(capsys) -> None:  # noqa: ANN001
    client = TestClient(_app())

    assert client.get("/things/abc-123").status_code == 200

    (line,) = _lines(capsys)
    # The template, not the concrete id — otherwise `by route` in Logs Insights
    # produces one bucket per restaurant and the p90 is meaningless.
    assert line["route"] == "GET /things/{thing_id}"
    assert line["status"] == 200
    assert line["ms"] >= 0


def test_counts_connections_and_queries_across_the_threadpool_hop(capsys) -> None:  # noqa: ANN001
    # NullPool mirrors production today: every `connect()` is a real Handshake.
    engine = create_engine("sqlite://", poolclass=NullPool)
    install_engine_instrumentation(engine)
    client = TestClient(_app(engine))

    assert client.get("/things/x").status_code == 200

    (line,) = _lines(capsys)
    assert line["db_connects"] == 1, "engine events did not reach the request's ContextVar"
    assert line["db_queries"] == 2
    assert line["db_ms"] >= 0
    # Handshake time is tracked separately from query time: it's the half that
    # step 2 removes, and the `connect` event alone fires too late to see it.
    assert line["db_connect_ms"] >= 0


def test_pooling_shows_up_as_fewer_connects_not_fewer_queries(capsys) -> None:  # noqa: ANN001
    """The assertion step 2 will be judged on: same queries, no new Handshake.

    StaticPool, not sqlite's default: the default for an in-memory database is
    SingletonThreadPool, which is scoped *per thread*, and FastAPI hands
    consecutive requests to different threadpool workers — so it would open a
    second connection and look exactly like no pooling at all. StaticPool is
    the honest model of one connection genuinely reused, which is what
    QueuePool will give production.
    """
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    install_engine_instrumentation(engine)
    client = TestClient(_app(engine))

    client.get("/things/first")
    client.get("/things/second")

    first, second = _lines(capsys)
    assert first["db_connects"] == 1  # opened it
    assert second["db_connects"] == 0  # reused it — this is the win we're measuring
    assert second["db_queries"] == 2  # while doing the same work
    assert second["db_connect_ms"] == 0  # and paid no handshake to do it


def test_unmatched_route_falls_back_to_the_raw_path(capsys) -> None:  # noqa: ANN001
    client = TestClient(_app())

    assert client.get("/nope").status_code == 404

    (line,) = _lines(capsys)
    assert line["route"] == "GET /nope"
    assert line["status"] == 404


def test_still_logs_when_the_endpoint_raises(capsys) -> None:  # noqa: ANN001
    client = TestClient(_app(), raise_server_exceptions=False)

    assert client.get("/boom").status_code == 500

    (line,) = _lines(capsys)
    assert line["status"] == 500
    assert line["route"] == "GET /boom"


def test_first_request_in_a_container_is_flagged_cold(capsys) -> None:  # noqa: ANN001
    import src.infra.middleware.timing as timing

    timing._container_is_cold = True  # simulate a fresh container
    client = TestClient(_app())

    client.get("/things/a")
    client.get("/things/b")

    first, second = _lines(capsys)
    assert first["cold"] is True
    assert second["cold"] is False
