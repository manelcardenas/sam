"""Tests for the per-IP RateLimitMiddleware safety guard."""

from fastapi import FastAPI
from starlette.testclient import TestClient

from src.infra.middleware import RateLimitMiddleware


def _app(limit: int) -> FastAPI:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, limit_per_minute=limit)

    @app.get("/ping")
    def ping() -> dict[str, str]:
        return {"pong": "ok"}

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


def test_allows_up_to_the_limit_then_429s() -> None:
    client = TestClient(_app(limit=3))

    for _ in range(3):
        assert client.get("/ping").status_code == 200

    blocked = client.get("/ping")
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers
    assert blocked.json()["detail"]


def test_health_is_exempt() -> None:
    client = TestClient(_app(limit=1))

    # First /ping uses the single allowed slot...
    assert client.get("/ping").status_code == 200
    assert client.get("/ping").status_code == 429
    # ...but /health is never throttled.
    for _ in range(5):
        assert client.get("/health").status_code == 200


def test_x_forwarded_for_is_used_as_client_ip() -> None:
    client = TestClient(_app(limit=1))

    assert client.get("/ping", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    # Same forwarded IP is now over the limit...
    assert client.get("/ping", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 429
    # ...while a different IP still has its own budget.
    assert client.get("/ping", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 200
