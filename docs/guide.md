# Recipe Manager - Developer Guide

Complete guide for developing, testing, and deploying the Recipe Manager API.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────-┐
│                              CLIENTS                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  FrontEnd    │  │  Swagger UI  │  │    curl      │  │   Postman    │      │
│  │  (Admin UI)  │  │   (Docs)     │  │              │  │              │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │                 │              │
│         └─────────────────┴────────┬────────┴─────────────────┘              │
│                                    │                                         │
│                           HTTP (port 9000)                                   │
│                                    │                                         │
│                                    ▼                                         │
│                          ┌─────────────────┐                                 │
│                          │   FastAPI App   │                                 │
│                          └────────┬────────┘                                 │
│                                   │                                          │
│                    USE_DYNAMODB=? │                                          │
│                    ┌──────────────┴──────────────┐                           │
│                    │                             │                           │
│                    ▼                             ▼                           │
│          ┌─────────────────┐          ┌─────────────────┐                    │
│          │ InMemory Repo   │          │ DynamoDB Repo   │                    │
│          │ (Dict in RAM)   │          │ (boto3 client)  │                    │
│          └─────────────────┘          └────────┬────────┘                    │
│                                                │                             │
│                                                ▼                             │
│                                     ┌─────────────────┐                      │
│                                     │ DynamoDB Local  │                      │
│                                     │ (Docker: 8000)  │                      │
│                                     └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone and install
git clone <repository-url>
cd sam
cp .env.example .env
uv sync --group dev

# Run locally (InMemory, fast iteration)
uv run uvicorn backend.src.main:app --reload --port 9000

# Or run with Docker (DynamoDB Local, integration testing)
docker compose up
```

Visit **http://localhost:9000/docs** for interactive API documentation.

## Development Modes

### Mode 1: Local (InMemory)

**Use for:** Unit tests, rapid iteration, no external dependencies

**Storage:** Python dict (data lost on restart)

```bash
# Start API
uv run uvicorn backend.src.main:app --reload --port 9000

# Test
curl http://localhost:9000/health
curl http://localhost:9000/recipes
```

The `USE_DYNAMODB` environment variable defaults to `false`.

### Mode 2: Docker (DynamoDB Local)

**Use for:** Integration testing, realistic DB behavior

**Storage:** DynamoDB Local (persists until `docker compose down`)

```bash
# Start everything (API + DynamoDB + table init)
docker compose up

# In background
docker compose up -d

# View logs
docker compose logs -f api

# Stop
docker compose down
```

The `docker-compose.yml` sets `USE_DYNAMODB=true` automatically.

---

## Testing the API

### Swagger UI (Recommended)

Interactive API docs with live testing:

- **Swagger UI**: http://localhost:9000/docs
- **ReDoc**: http://localhost:9000/redoc

Features: Try endpoints in browser, see schemas, no installation.

### curl / Postman

```bash
# List recipes
curl http://localhost:9000/recipes

# Create recipe
curl -X POST http://localhost:9000/recipes \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Pasta Carbonara",
    "description": "Classic Italian pasta",
    "ingredients": ["spaghetti", "eggs", "bacon", "parmesan"]
  }'

# Get recipe
curl http://localhost:9000/recipes/{recipe_id}

# Update recipe
curl -X PUT http://localhost:9000/recipes/{recipe_id} \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "description": "Updated description",
    "ingredients": ["new", "ingredients"]
  }'

# Delete recipe
curl -X DELETE http://localhost:9000/recipes/{recipe_id}
```

---

## Running Tests

Unit tests use InMemory repository (no Docker required):

```bash
# Run all tests
uv run pytest tests/ -v

# Run specific test file
uv run pytest tests/unit/test_use_cases.py -v

# Run with coverage
uv run pytest tests/ --cov=backend/src --cov-report=html
```

Integration tests (full HTTP):

```bash
uv run python tests/test_integration.py
```

---

## Code Quality

```bash
# Lint and auto-fix
uv run ruff check . --fix

# Format code
uv run ruff format .

# Run pre-commit hooks
uv run pre-commit run --all-files

# Install git hooks
uv run pre-commit install
```

---

## Environment Variables

| Variable                | Default     | Description                           |
| ----------------------- | ----------- | ------------------------------------- |
| `USE_DYNAMODB`          | `false`     | `true` = DynamoDB, `false` = InMemory |
| `PORT`                  | `9000`      | API server port                       |
| `HOST`                  | `0.0.0.0`   | API server host                       |
| `TABLE_NAME`            | `recipes`   | DynamoDB table name                   |
| `DYNAMODB_ENDPOINT`     | -           | DynamoDB endpoint (for local dev)     |
| `AWS_REGION`            | `eu-west-3` | AWS region                            |
| `AWS_ACCESS_KEY_ID`     | -           | AWS credentials                       |
| `AWS_SECRET_ACCESS_KEY` | -           | AWS credentials                       |

**Local dev:** Set `USE_DYNAMODB=false` (or unset, it's the default)

**Docker dev:** Automatically set to `true` in `docker-compose.yml`

**AWS prod:** Set `USE_DYNAMODB=true` + real AWS credentials

---

## Docker Tips

```bash
# Rebuild after code changes
docker compose up --build

# Remove volumes (reset DynamoDB)
docker compose down -v

# Check logs
docker compose logs -f api
docker compose logs dynamodb-init

# Execute command in container
docker compose exec api sh
```

---

## CI/CD

GitHub Actions workflow runs on every push/PR:

1. Lint with Ruff
2. Format check
3. Run pytest (uses InMemory, no Docker)

See `.github/workflows/test.yml`

---

## Troubleshooting

**"Table not found" error in Docker:**

- Check `docker logs sam-dynamodb-init-1` for table creation output
- Restart: `docker compose down && docker compose up`

**Port 9000 already in use:**

- Change PORT in `.env`: `PORT=8080`
- Restart with: `docker compose up` (reads from `.env`)

**Tests failing:**

- Ensure no API server running on port 9000
- Run: `uv sync --group dev` to install dependencies
- Check: `uv run pytest tests/ -v`

**ImportError in tests:**

- Run: `uv sync --group dev` to install pytest
- Verify: `uv run python -c "import pytest; print(pytest.__version__)"`
