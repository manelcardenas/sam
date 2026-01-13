# Agent Guidelines

Guidelines for AI coding agents working in this repository.

## Project Overview

Recipe Manager - A clean architecture Python application with separated backend/frontend.

```
sam/
├── backend/src/           # Backend code (domain, use cases, infrastructure)
│   ├── app/use_cases/     # Application layer - business operations
│   ├── domain/            # Core business logic
│   │   ├── entities/      # Pydantic models (Recipe, User)
│   │   └── ports/         # Abstract interfaces (repositories)
│   └── infra/adapters/    # Implementations (DynamoDB, in-memory)
├── frontend/cli/          # Streamlit dev UI
├── tests/                 # Integration tests
└── pyproject.toml         # Dependencies and tooling config
```

## Build/Test Commands

```bash
# Install all dependencies
uv sync --group dev --group frontend

# Install backend only (no streamlit)
uv sync --group dev

# Run all tests
uv run python tests/test_integration.py

# Lint and format (auto-fix)
uv run ruff check . --fix && uv run ruff format .

# Run Streamlit UI
uv run streamlit run frontend/cli/streamlit_app.py

# Pre-commit hooks
uv run pre-commit install
uv run pre-commit run --all-files
```

## Code Style

### Ruff Configuration (pyproject.toml)

- **Line length**: 170 characters
- **Target**: Python 3.13
- **Enabled rules**: ANN, ARG, E, F, I, ICN, N, RUF, PT, W, UP
- **Ignored**: ANN002, ANN003 (no type hints for *args/**kwargs), E501, E203

### Import Order (isort via Ruff)

Standard library → Third-party → Local imports

```python
import uuid
from abc import ABC, abstractmethod
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from backend.src.domain.entities import Recipe
from backend.src.domain.ports import RecipeRepository
```

### Type Hints

Required on all functions and methods:

```python
def execute(self, recipe: Recipe) -> Recipe:
    return self.repository.add_recipe(recipe)

def get_recipe(self, recipe_id: str) -> Recipe | None:
    return self.table.get(recipe_id)
```

### Naming Conventions (PEP8)

- **Classes**: PascalCase (`CreateRecipe`, `RecipeRepository`)
- **Functions/methods**: snake_case (`get_recipe`, `list_recipes`)
- **Variables**: snake_case (`recipe_data`, `created_at`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_TIMEOUT`)

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

Always use UTC with ISO format:

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

### Module Exports

Always define `__all__` in `__init__.py`:

```python
from backend.src.app.use_cases.create_recipe import CreateRecipe
from backend.src.app.use_cases.delete_recipe import DeleteRecipe

__all__ = ["CreateRecipe", "DeleteRecipe"]
```

## Architecture Patterns

### Clean Architecture Layers

1. **Domain** (`backend/src/domain/`): Pure business logic, no external dependencies
2. **Application** (`backend/src/app/use_cases/`): Orchestrates domain logic
3. **Infrastructure** (`backend/src/infra/`): External adapters (DB, APIs)
4. **Presentation** (`frontend/`): UI layer

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

Interface in `domain/ports/`, implementation in `infra/adapters/`:

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
        return Recipe(**self.table[recipe.id])  # New instance, not reference
```

## Pre-commit Hooks

Runs on commit: `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-toml`,
`check-added-large-files`, `check-merge-conflict`, `gitleaks`, `ruff-check`, `ruff-format`
