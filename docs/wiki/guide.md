# Recipe Manager — Developer Guide

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          CLIENTS                             │
│   Swagger UI   │   curl / Postman   │   React Frontend       │
└────────────────────────────┬─────────────────────────────────┘
                             │ HTTP (port 9000)
                             ▼
                    ┌─────────────────┐
                    │   FastAPI App   │
                    │  (+ Mangum for  │
                    │    Lambda)      │
                    └────────┬────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ PostgresRecipeRepo   │  ← production
                  │ InMemoryRecipeRepo   │  ← unit tests only
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  PostgreSQL          │
                  │  (local Docker /     │
                  │   Aurora Serverless) │
                  └──────────────────────┘
```

**Dependency rule:** Domain → Use Cases → Infrastructure. Inner layers never import from outer layers.

---

## Development Modes

### Mode 1: Local (Postgres via Docker)

**Use for:** Normal development and integration testing.

```bash
# Start only the database
docker compose up postgres -d

# Run API with hot-reload
uv run uvicorn backend.src.main:app --reload --port 9000
```

The app connects to `localhost:5432` using credentials from the root `.env`.

### Mode 2: Full Docker stack

**Use for:** Simulating the production environment (migrations run automatically).

```bash
docker compose up        # postgres + migrate + api
docker compose up -d     # background
docker compose logs -f api
docker compose down      # stop (data persists in named volume)
docker compose down -v   # stop + wipe database
```

---

## Database Migrations (Alembic)

Migrations live in `backend/alembic/versions/`.

```bash
cd backend

# After changing a SQLAlchemy model in src/infra/db/models.py:
uv run alembic revision --autogenerate -m "add column X to recipes"

# Review the generated file in alembic/versions/ before applying!

# Apply to local postgres
uv run alembic upgrade head

# Roll back one migration
uv run alembic downgrade -1

# Show current version
uv run alembic current
```

Alembic uses a sync psycopg2 connection (separate from the async runtime engine). Credentials are loaded automatically from the root `.env`.

---

## Seed Data

```bash
# postgres must be running
uv run python -m backend.scripts.seed
```

Inserts 14 traditional Spanish recipes. The script is **idempotent** — it skips recipes whose title already exists in the DB.

---

## Testing

Unit tests use `InMemoryRecipeRepository` — no Docker or database needed.

```bash
uv run pytest tests/ -v
uv run pytest tests/ --cov=backend/src --cov-report=html
```

---

## Environment Variables

| Variable            | Default          | Description                  |
| ------------------- | ---------------- | ---------------------------- |
| `POSTGRES_HOST`     | `localhost`      | Postgres host                |
| `POSTGRES_PORT`     | `5432`           | Postgres port                |
| `POSTGRES_DB`       | `recipe_manager` | Database name                |
| `POSTGRES_USER`     | `postgres`       | Database user                |
| `POSTGRES_PASSWORD` | `postgres`       | Database password            |
| `PORT`              | `9000`           | API server port              |
| `HOST`              | `0.0.0.0`        | API server bind address      |
| `COGNITO_USER_POOL_ID` | —             | Cognito pool ID (from CDK)   |
| `COGNITO_CLIENT_ID`    | —             | Cognito client ID (from CDK) |

---

## Code Quality

```bash
uv run ruff check . --fix && uv run ruff format .
uv run pre-commit run --all-files
uv run pre-commit install     # install git hooks
```

---

## Key Design Decisions

### `DatabaseConnectionPool` with `NullPool`

The reference pattern (from the ECS service) encapsulates the engine in a `DatabaseConnectionPool` class with `open()` / `close()` lifecycle methods. FastAPI's lifespan calls these on startup/shutdown.

For **Lambda**, the pool is configured with `NullPool` instead of a persistent pool. Each DB call opens a fresh connection and closes it immediately — this prevents connection leaks across Lambda invocations where the OS-level TCP socket might be reused between unrelated requests.

### Sync SQLAlchemy (psycopg2) vs async (asyncpg)

The repository layer uses **synchronous SQLAlchemy** with psycopg2. FastAPI runs sync route handlers in a thread pool, so blocking DB calls are safe and don't block the event loop.

This avoids the need to make the entire domain/use-case/port stack async — a significant refactor with no benefit at Lambda scale (a single-threaded invocation model).

### InMemoryRecipeRepository kept for unit tests

The in-memory implementation allows unit tests to run without any infrastructure. Tests remain fast and free of external dependencies.

---

## Troubleshooting

**`POSTGRES_HOST` not set on startup:**
The app calls `build_dsn()` at import time. Ensure `.env` is at the repo root and contains `POSTGRES_HOST`. Running `uv run uvicorn ...` from the repo root loads it automatically.

**`could not connect to server` on startup:**
Run `docker compose up postgres -d` and wait for the healthcheck to pass.

**Port 9000 already in use:**
Change `PORT=8080` in `.env` and restart.
