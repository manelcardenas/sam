import json
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from src.infra.observability import start_db_metrics

_container_is_cold = True


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Emits one JSON line per request: route, status, wall time, DB cost.

    Pure measurement — it changes no behaviour and is deliberately the first
    thing shipped in the latency plan, because CloudWatch's `REPORT` line
    carries no route. Without this, a slow Geoapify place search and a slow
    restaurant list are the same data point, and the plan's unattributed
    2-3 s at the p90 stays unattributed.

    Written to stdout rather than through `logging` because the app configures
    no handlers, so a logger's output would depend on whatever the Lambda
    runtime happens to install. `dependencies.py` already prints directly for
    the same reason.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        global _container_is_cold
        was_cold = _container_is_cold
        _container_is_cold = False

        # Must be set before dispatching downstream: anyio copies the context
        # into the child task, so a later set() would not be seen here.
        metrics = start_db_metrics()
        started = time.perf_counter()
        status = 500  # if the stack raises, that's what the client gets

        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            route = request.scope.get("route")
            template = getattr(route, "path", None) or request.url.path
            print(
                json.dumps(
                    {
                        "evt": "req",
                        "route": f"{request.method} {template}",
                        "status": status,
                        "ms": round(elapsed_ms, 1),
                        "db_connects": metrics.connects,
                        "db_connect_ms": round(metrics.connect_ms, 1),
                        "db_queries": metrics.queries,
                        "db_ms": round(metrics.ms, 1),
                        "cold": was_cold,
                    }
                ),
                flush=True,
            )
