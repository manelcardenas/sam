import time
from collections import defaultdict, deque
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

# Never throttle health checks (load balancers / docker hit these constantly).
_EXEMPT_PATHS = frozenset({"/health"})
# Sweep idle IPs out of the table once it grows past this, to bound memory.
_EVICT_THRESHOLD = 10_000


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window per-IP rate limiter — a lightweight safety guard."""

    def __init__(self, app: ASGIApp, *, limit_per_minute: int = 120) -> None:
        super().__init__(app)
        self.limit = limit_per_minute
        self.window_seconds = 60
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    @staticmethod
    def _client_ip(request: Request) -> str:
        # Behind a proxy/API Gateway the real client is the first X-Forwarded-For hop.
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _evict_idle(self, cutoff: float) -> None:
        """Drop IPs whose most recent request is outside the window."""
        stale = [ip for ip, hits in self._hits.items() if not hits or hits[-1] < cutoff]
        for ip in stale:
            del self._hits[ip]

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path in _EXEMPT_PATHS:
            return await call_next(request)

        ip = self._client_ip(request)
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            if len(self._hits) > _EVICT_THRESHOLD:
                self._evict_idle(cutoff)

            hits = self._hits[ip]
            while hits and hits[0] < cutoff:
                hits.popleft()

            if len(hits) >= self.limit:
                retry_after = int(self.window_seconds - (now - hits[0])) + 1
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please slow down."},
                    headers={"Retry-After": str(retry_after)},
                )

            hits.append(now)

        return await call_next(request)
