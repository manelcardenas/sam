import os


class MiddlewareSettings:
    """Centralized reads of middleware-related env vars."""

    def __init__(self) -> None:
        # --- CORS --- (empty list => disabled)
        raw_origins = os.getenv("CORS_ALLOW_ORIGINS", "")
        self.cors_allow_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

        # --- Rate limiting (per-IP, per-process) --- 0 disables it.
        self.rate_limit_per_minute = int(os.getenv("RATE_LIMIT_PER_MINUTE", "120"))
