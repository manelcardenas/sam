# Recipe Manager

## Quick Start (local, no Docker)

```bash
uv sync --group dev
uv run uvicorn backend.src.main:app --reload --port 9000
open http://localhost:9000/docs
```

Requires a running PostgreSQL instance. The fastest way to get one:

```bash
docker compose up postgres -d
```

Environment variables are read from the root `.env` (already populated with local defaults).

## Docker — full stack

```bash
# Start postgres + run migrations + start API
docker compose up

# Visit API docs
open http://localhost:9000/docs

# Stop (keeps postgres data)
docker compose down

# Stop and wipe the database
docker compose down -v
```

## API Endpoints

| Method | Endpoint        | Description      |
| ------ | --------------- | ---------------- |
| GET    | `/health`       | Health check     |
| GET    | `/recipes`      | List all recipes |
| POST   | `/recipes`      | Create recipe    |
| GET    | `/recipes/{id}` | Get recipe by ID |
| PUT    | `/recipes/{id}` | Update recipe    |
| DELETE | `/recipes/{id}` | Delete recipe    |

All recipe endpoints require a valid Cognito JWT (`Authorization: Bearer <token>`).

Interactive docs: **http://localhost:9000/docs**

## Database Migrations (Alembic)

```bash
# Generate a new migration after changing SQLAlchemy models
cd backend
uv run alembic revision --autogenerate -m "describe your change"

# Apply all pending migrations
uv run alembic upgrade head

# Roll back one step
uv run alembic downgrade -1
```

## Seed Data

Load the 14 original recipes into a fresh database:

```bash
# Postgres must be running first
uv run python -m backend.scripts.seed
```

The script is idempotent — safe to run multiple times.

## Testing

```bash
# Unit tests (no Docker required — uses InMemory repo)
uv run pytest tests/ -v

# With coverage
uv run pytest tests/ --cov=backend/src
```

## Code Quality

```bash
uv run ruff check . --fix && uv run ruff format .
uv run pre-commit run --all-files
uv run pre-commit install   # install git hooks
```

## Documentation

See `docs/wiki/guide.md` for the full developer guide.

> **Aurora cold starts:** Aurora Serverless v2 with `minCapacity=0` can take 30–60 s to wake after idle.
> The first request after a quiet period will be slow — this is expected and accepted at current scale.

TODOs:
1. Separar bien las pipelines de github
2. Review infra in aws
3. Review the code, docu(structure it correctly) and make it work be/fe locally
4. Add restaurant reviews -> use improvements-plan.md Phase 2
5. Final FE improvements make the ui look better
6. See `TODO.md` — user-profile work (show recipe author in FE, profile-completion flow)
