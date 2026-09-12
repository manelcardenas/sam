"""Every FastAPI route has a matching API Gateway route, and vice versa.

**Why this test is worth more than it looks.** The production HTTP API in
`infra/lib/application/lambda-api-stack.ts` declares each route *explicitly* —
it is not a catch-all `{proxy+}`. So adding a route to the FastAPI app is not
enough: without a matching `httpApi.addRoutes(...)`, API Gateway returns **404
before the Lambda is ever invoked**.

That failure is nasty to diagnose because it does not look like a routing
problem. The Lambda is healthy, CloudWatch shows nothing, other endpoints work,
and the tell-tale — one path 404s while `/recipes` returns 401 — only helps if
you already suspect the gateway. It has happened here before.

The check is a string comparison against the CDK source rather than a synthesised
template, which is cruder but has no CDK dependency and no synth step, and the
thing being guarded is exactly a missing line in that file.
"""

import os
import re
from pathlib import Path

import pytest

STACK = Path(__file__).resolve().parents[3] / "infra" / "lib" / "application" / "lambda-api-stack.ts"

# FastAPI serves these itself; they are not part of the product's surface and
# are deliberately not exposed through the gateway.
DOCS_ROUTES = {"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"}


def _app_paths() -> set[str]:
    # build_dsn() reads these; nothing connects until the lifespan runs, so the
    # app can be constructed without a database.
    for key, value in {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "test",
        "POSTGRES_USER": "test",
        "POSTGRES_PASSWORD": "test",
        "POSTGRES_SSLMODE": "disable",
    }.items():
        os.environ.setdefault(key, value)

    from src.main import create_app

    return {route.path for route in create_app().routes if hasattr(route, "methods")} - DOCS_ROUTES


def _gateway_paths() -> set[str]:
    source = STACK.read_text(encoding="utf-8")
    return set(re.findall(r'path:\s*"([^"]+)"', source))


@pytest.mark.skipif(not STACK.exists(), reason="CDK stack not present in this checkout")
def test_every_api_route_is_registered_on_the_gateway() -> None:
    missing = _app_paths() - _gateway_paths()

    assert not missing, f"These FastAPI routes have no httpApi.addRoutes() entry in {STACK.name}, so API Gateway will 404 them before the Lambda runs: {sorted(missing)}"


@pytest.mark.skipif(not STACK.exists(), reason="CDK stack not present in this checkout")
def test_the_gateway_declares_no_routes_the_api_does_not_serve() -> None:
    """The other direction, which fails more quietly.

    A gateway route pointing at a path FastAPI no longer serves reaches the
    Lambda and returns a 404 from the application — indistinguishable from a
    typo in the caller's URL, and it keeps the dead path looking alive.
    """
    orphaned = _gateway_paths() - _app_paths()

    assert not orphaned, f"These gateway routes have no FastAPI handler: {sorted(orphaned)}"
