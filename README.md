# Recipe Manager

## Run it locally

Three commands — Postgres, the API, the web app:

```bash
docker compose up postgres -d              # 1. database
cd backend  && uv run start                # 2. API  → http://localhost:9000 (migrates + seeds, then serves)
cd frontend && npm install && npm run dev  # 3. web  → http://localhost:8080
```

Open **http://localhost:8080** and sign in with the test account
(`test@example.com` / `TestPass123!`). The DB comes pre-seeded with 14 recipes
(author **Nel**); a brand-new login is sent to `/profile/complete` to choose a
display name first.

<details>
<summary>First-time setup (env + test user) — run once</summary>

```bash
cp .env.example .env                            # backend: local Postgres defaults + your Cognito IDs
cp frontend/.env.example frontend/.env.local    # frontend: your Cognito IDs (see below)
./backend/scripts/create_test_user.sh           # creates test@example.com / TestPass123! in Cognito
```

Two things that bite if missed:

1. **Point the frontend at the local API.** In `frontend/.env.local` set:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:9000
   ```
   Leave it as the deployed API Gateway URL and you'll log in fine but
   read/write **production** data instead of your local seeded DB.

2. **The test user is created once and persists.** After running
   `create_test_user.sh` a single time, just open the dev site and sign in with
   `test@example.com` / `TestPass123!` — no need to re-run it. (Its printed
   1-hour token is only for `curl`-ing the API directly; the web app does its
   own Cognito sign-in.)

Auth is real Cognito (free), so both env files need the same
`COGNITO_*` / `NEXT_PUBLIC_USER_POOL_*` values. Only the DB is local.
</details>

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
3. Review the code, docu(structure it correctly) and make it work be/fe locally
4. Add restaurant reviews -> use improvements-plan.md Phase 2
5. Final FE improvements make the ui look better
6. See `TODO.md` — user-profile work (show recipe author in FE, profile-completion flow)
