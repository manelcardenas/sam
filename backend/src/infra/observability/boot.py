"""How long a cold start spends in each phase, as one JSON line per process.

The request line (`RequestTimingMiddleware`) marks the first request of a process
`"cold": true` but cannot say where the time before it went. On Vercel a cold
plan-page request measured ~2.9 s from outside against ~240 ms inside the
handler (2026-11-14), so ~2.5 s happened before FastAPI saw the request. This
splits the part the app controls:

- `imports_ms` — process start to `create_app()`: interpreter start-up plus every
  module import. Read from `/proc`, so Linux only (Vercel, Lambda); `null` on a Mac.
- `create_app_ms` — building the app: repositories, controllers, SSM/env reads.
- `db_open_ms` — the lifespan's first database connection (it pings Neon, so a
  suspended compute shows up here as its wake-up time).

Whatever remains of an outside cold measurement after these three and the
request's own `ms` is the platform's: starting the instance and loading the
bundle. Printed to stdout for the same reason as the request line — the app
configures no logging handlers.
"""

import json
import os
import time


def process_age_ms() -> float | None:
    """Milliseconds since this process started, or None where `/proc` doesn't exist."""
    try:
        with open("/proc/self/stat") as stat:
            # Field 22 (starttime, in clock ticks since boot). The command name in
            # field 2 is parenthesised and may contain spaces, so split after it.
            start_ticks = int(stat.read().rsplit(")", 1)[1].split()[19])
        with open("/proc/uptime") as uptime:
            uptime_s = float(uptime.read().split()[0])
    except (OSError, ValueError, IndexError):
        return None
    return round((uptime_s - start_ticks / os.sysconf("SC_CLK_TCK")) * 1000, 1)


class BootTimer:
    """Collects the three phases and prints them once the database is open."""

    def __init__(self) -> None:
        self.imports_ms = process_age_ms()
        self._started = time.perf_counter()
        self.create_app_ms: float | None = None

    def app_created(self) -> None:
        self.create_app_ms = round((time.perf_counter() - self._started) * 1000, 1)

    def db_opened(self, db_open_ms: float) -> None:
        print(
            json.dumps(
                {
                    "evt": "boot",
                    "imports_ms": self.imports_ms,
                    "create_app_ms": self.create_app_ms,
                    "db_open_ms": round(db_open_ms, 1),
                }
            ),
            flush=True,
        )
