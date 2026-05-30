# Agent Guidelines

Guidelines for AI coding agents working in this repository.

## Project Overview

Recipe Manager - A clean architecture FastAPI application for managing recipes.

**Architecture:** Domain → Use Cases → Infrastructure (ports & adapters pattern)

```
sam/
├── backend/src/
│   ├── domain/           # Core business logic (no external dependencies)
│   │   ├── entities/     # Pydantic models (Recipe)
│   │   └── ports/        # Abstract interfaces (RecipeRepository)
│   ├── app/use_cases/    # Application layer - orchestrates domain logic
│   ├── infra/
│   │   ├── adapters/     # Interface implementations (InMemory, DynamoDB)
│   │   └── controllers/  # HTTP controllers (FastAPI routes)
│   └── main.py           # FastAPI app factory + Lambda handler
├── frontend/admin/       # Streamlit UI (not in active use)
├── tests/
│   ├── unit/             # Use case tests (InMemory repo)
│   └── integration/      # HTTP API tests
└── pyproject.toml        # Dependencies and tooling config
```

## Build/Test Commands

```bash
# Install dependencies
uv sync --group dev

# Run all tests
uv run pytest tests/ -v

# Run specific test file
uv run pytest tests/unit/test_use_cases.py -v

# Run specific test class
uv run pytest tests/unit/test_use_cases.py::TestCreateRecipe -v

# Run single test
uv run pytest tests/unit/test_use_cases.py::TestCreateRecipe::test_creates_recipe_successfully -v

# Run with coverage
uv run pytest tests/ --cov=backend/src --cov-report=html

# Lint and format (auto-fix)
uv run ruff check . --fix && uv run ruff format .

# Check only (no changes)
uv run ruff check . && uv run ruff format --check .

# Run pre-commit hooks
uv run pre-commit run --all-files
uv run pre-commit install  # Install git hooks

# Run FastAPI server (local - InMemory)
uv run uvicorn backend.src.main:app --reload --port 9000

# Run with Docker (DynamoDB Local)
docker compose up
docker compose down

# View API docs
open http://localhost:9000/docs
```

## Code Style

### Ruff Configuration

- **Line length:** 170 characters
- **Target:** Python 3.13
- **Enabled rules:** ANN, ARG, E, F, I, ICN, N, RUF, PT, W, UP
- **Ignored:** ANN002, ANN003 (no type hints for \*args/\*\*kwargs), E501, E203

### Import Order (isort via Ruff)

Standard library → Third-party → Local imports, with blank lines between groups:

```python
import uuid
from abc import ABC, abstractmethod
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from src.domain.entities import Recipe
from src.domain.ports import RecipeRepository
```

### Type Hints

**Required on all functions and methods.** Use modern Python 3.13 syntax:

```python
def execute(self, recipe: Recipe) -> Recipe:
    return self.repository.add_recipe(recipe)

def get_recipe(self, recipe_id: str) -> Recipe | None:  # Use | not Optional
    return self.table.get(recipe_id)

def list_recipes(self) -> list[Recipe]:  # Use list[] not List[]
    return [Recipe(**data) for data in self.table.values()]
```

### Naming Conventions (PEP8)

- **Classes:** PascalCase (`CreateRecipe`, `RecipeRepository`)
- **Functions/methods:** snake_case (`get_recipe`, `list_recipes`)
- **Variables:** snake_case (`recipe_data`, `created_at`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_TIMEOUT`)

### Pydantic Models

Use `Field(default_factory=...)` for dynamic defaults:

```python
class Recipe(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    ingredients: list[str]
    created_at: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
```

### Timestamps

**Always use UTC with ISO format:**

```python
from datetime import UTC, datetime

timestamp = datetime.now(UTC).isoformat()
# NOT: datetime.now().isoformat() or datetime.utcnow().isoformat()
```

### Error Handling

Raise `KeyError` for missing items (mimics DynamoDB behavior):

```python
def delete_recipe(self, recipe_id: str) -> None:
    if recipe_id not in self.table:
        raise KeyError(f"Recipe with id {recipe_id} not found")
    del self.table[recipe_id]
```

Use `HTTPException` in controllers:

```python
from fastapi import HTTPException, status

def get_recipe(self, recipe_id: str) -> Recipe:
    recipe = use_case.execute(recipe_id)
    if recipe is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recipe with id {recipe_id} not found"
        )
    return recipe
```

### Module Exports

Always define `__all__` in `__init__.py`:

```python
from src.app.use_cases.create_recipe import CreateRecipe
from src.app.use_cases.delete_recipe import DeleteRecipe

__all__ = ["CreateRecipe", "DeleteRecipe"]
```

## Architecture Patterns

### Clean Architecture Layers

1. **Domain** (`backend/src/domain/`): Pure business logic, no external dependencies
2. **Application** (`backend/src/app/use_cases/`): Orchestrates domain logic
3. **Infrastructure** (`backend/src/infra/`): External adapters (DB, HTTP)
4. **Presentation** (`frontend/`): UI layer (future React app)

**Dependency rule:** Inner layers never depend on outer layers.

### Dependency Injection

Use cases receive repositories via constructor:

```python
class CreateRecipe:
    def __init__(self, recipe_repository: RecipeRepository) -> None:
        self.recipe_repository = recipe_repository

    def execute(self, recipe: Recipe) -> Recipe:
        return self.recipe_repository.add_recipe(recipe)
```

### Repository Pattern

Interface in `domain/ports/`, implementations in `infra/adapters/`:

```python
# Port (interface)
class RecipeRepository(ABC):
    @abstractmethod
    def add_recipe(self, recipe: Recipe) -> Recipe:
        pass

# Adapter (implementation)
class InMemoryRecipeRepository(RecipeRepository):
    def add_recipe(self, recipe: Recipe) -> Recipe:
        self.table[recipe.id] = recipe.model_dump()
        return Recipe(**self.table[recipe.id])  # New instance to prevent mutations
```

## Environment Variables

Repositories are backed by Postgres. A single `DatabaseConnectionPool` is
built from the `POSTGRES_*` env vars and shared across all repositories via the
FastAPI lifespan:

```python
# backend/src/main.py
db = DatabaseConnectionPool(dsn=build_dsn())  # reads POSTGRES_HOST, POSTGRES_DB, ...
recipe_repository = PostgresRecipeRepository(session_factory=db.session_factory)
user_repository = PostgresUserRepository(session_factory=db.session_factory)
```

Required: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_SSLMODE`.

## Pre-commit Hooks

Runs on commit: `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-toml`,
`check-added-large-files`, `check-merge-conflict`, `gitleaks`, `ruff-check`, `ruff-format`
