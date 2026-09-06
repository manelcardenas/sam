# ADR-0006: Pool database connections on Lambda instead of NullPool

- **Status:** Accepted (2026-09-04)
- **Context:** [`../plans/routing-and-latency-plan.md`](../plans/routing-and-latency-plan.md) §2, §4
- **Supersedes:** the `NullPool` rationale in `src/infra/db/engine.py`

## Context

`engine.py` creates the engine with `poolclass=NullPool`, documented as "the correct pattern
for Lambda: each call opens a fresh connection and closes it immediately, avoiding connection
leaks." That is the standard advice, and it was a reasonable default. Measured against
production it is also the single largest source of warm-request latency.

`NullPool` holds nothing, and every repository method opens its own session. So one
`GET /restaurants` performs **three** full TCP + TLS + Postgres-auth handshakes
(`ensure_user`, `search_restaurants`, `aggregate_for_restaurants`). Confirmed 2026-09-04: the
Neon project (`purple-frost-33606894`) is in `aws-eu-central-1` while the Lambda is in
`eu-west-3`, so each handshake is cross-region — roughly 60–90 ms rather than 15–25 ms, or
~200–270 ms per request of pure handshake before any query runs.

The engine is constructed at module scope (`main.py`, `app = create_app()`), so it outlives a
single invocation in a warm container. `NullPool` therefore discards a connection that the
container was in a position to reuse.

## Decision

Configure a small, bounded `QueuePool` with `pool_pre_ping` and `pool_recycle` instead of
`NullPool`. A warm container reuses one socket **across invocations**, not merely within one
request, so the steady-state handshake count per request goes to zero.

This is preferred over the originally planned alternative — a request-scoped `Session`
dependency — which touches 22 `self._session_factory()` call sites across five repositories,
moves the transaction boundary from per-repository-call to per-request, and still leaves every
request paying one full handshake. Pooling is one file and a strictly better result. The
request-scoped session may still be worth doing on *correctness* grounds; it is no longer
justified on latency grounds.

## Why the original NullPool rationale does not apply here

`NullPool`-on-Lambda guidance targets the case it was written for: many concurrent containers,
each holding idle connections against a fixed server-side connection limit. This deployment is
not that case.

- **Concurrency is ~1.** 481 invocations per 30 days, and a Lambda container serves one request
  at a time. A bounded pool of one connection per container cannot fan out.
- **Prod already sits behind Neon's PgBouncer.** `.env.example:19` documents the `-pooler`
  endpoint, so server-side connection multiplexing is already someone else's problem. Client
  pooling saves the handshake *to* PgBouncer.
- **Leaks were the stated fear, and sessions are already scoped.** Every call site uses
  `with self._session_factory()`, so connections are returned deterministically. `pool_recycle`
  bounds the lifetime of anything the pool retains.

## Consequences

**A pooled socket can be dead on arrival, and will be.** Two ways: the container is frozen
between invocations, and Neon's free plan scales the compute to zero after 5 minutes of
inactivity, which terminates it. `pool_pre_ping` issues a cheap liveness check before handing a
connection out and transparently replaces a dead one. A ping is ~1 round trip against the 5–7
of a full connect, so the bad case is still cheaper than today's every-time case.

**Neon's session context resets across a suspend** — in-memory stats, temp tables, prepared
statements. Nothing here relies on session state surviving, and psycopg2 does not use
server-side prepared statements by default, but this is why `pool_pre_ping` is mandatory rather
than optional.

**This does not keep the Neon compute awake, and therefore costs nothing.** Verified against
Neon's scale-to-zero documentation: the only connection-based exception that prevents
suspension is a connected *logical replication subscriber* with Neon as publisher. An ordinary
idle client connection does not. This matters because a keep-alive ping was explicitly rejected
in the plan for burning metered free-plan compute hours — pooling must not reintroduce that
cost by accident, and it does not.

**Co-location becomes much less interesting.** Cross-region cost drops from three handshakes to
one ~20 ms RTT per query. `routing-and-latency-plan.md` §4.8 is downgraded accordingly, which is
just as well: Neon has **no `eu-west-3` region**, so co-locating could only mean moving the
Lambda to Frankfurt — and Cognito user pools cannot be migrated across regions.

## Alternatives rejected

- **Request-scoped session only** — more work, worse result. See above.
- **Keep `NullPool`, accept the handshakes** — leaves ~200–270 ms on every warm request for a
  leak risk that this deployment's concurrency profile does not have.
- **Neon serverless HTTP driver** — removes the handshake by removing the socket, but it is a
  different driver with no SQLAlchemy ORM story, and would mean rewriting every repository.
