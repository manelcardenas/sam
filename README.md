# Recipe Manager

### Local Development (Fast)

```bash
# Install dependencies
uv sync --group dev
# To sync everything
uv sync --all-groups

# Run API server
uv run uvicorn backend.src.main:app --reload --port 9000

# Visit API docs
open http://localhost:9000/docs
```

Uses in-memory storage (data lost on restart). Perfect for rapid iteration.

### Docker (Integration Testing)

```bash
# Start API + DynamoDB Local
docker compose up

# Visit API docs
open http://localhost:9000/docs

# Stop
docker compose down
```

Uses DynamoDB Local. Data persists until containers removed.

## API Endpoints

| Method | Endpoint        | Description      |
| ------ | --------------- | ---------------- |
| GET    | `/health`       | Health check     |
| GET    | `/recipes`      | List all recipes |
| POST   | `/recipes`      | Create recipe    |
| GET    | `/recipes/{id}` | Get recipe by ID |
| PUT    | `/recipes/{id}` | Update recipe    |
| DELETE | `/recipes/{id}` | Delete recipe    |

Interactive docs: **http://localhost:9000/docs**

## Testing

```bash
# Run all tests
uv run pytest tests/ -v

# Run with coverage
uv run pytest tests/ --cov=backend/src
```

Tests use InMemory repository (no Docker required).

## Code Quality

```bash
# Lint and format
uv run ruff check . --fix && uv run ruff format .

# Pre-commit hooks
uv run pre-commit install
uv run pre-commit run --all-files
```

## Documentation

See `docs/guide.md` for complete developer guide.
