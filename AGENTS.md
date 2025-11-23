# Agent Guidelines

## Build/Test Commands
- **Install deps**: `uv sync --dev`
- **Run tests**: `uv run python tests/test_integration.py`
- **Run single test**: `uv run python tests/test_integration.py` (currently one test file)
- **Lint/format**: `uv run ruff check . --fix && uv run ruff format .`
- **Run Streamlit**: `uv run streamlit run src/cli/streamlit_app.py`

## Code Style (Ruff enforced, line length 170)
- **Imports**: Standard lib → third-party → local (`from datetime import UTC` before `from pydantic import BaseModel`)
- **Type hints**: Required on all functions (`def execute(self, recipe: Recipe) -> Recipe`)
- **Naming**: snake_case for functions/variables, PascalCase for classes
- **Timestamps**: Always use `datetime.now(UTC).isoformat()` for consistency
- **Pydantic models**: Use `Field(default_factory=...)` for dynamic defaults
- **Error handling**: Raise `KeyError` for missing items (mimics DynamoDB behavior)

## Architecture (Clean Architecture)
- **Domain** (`src/domain/`): Pure business logic, no external deps. Entities use Pydantic BaseModel
- **Application** (`src/app/use_cases/`): Use cases with dependency injection via `__init__(self, repository: RecipeRepository)`
- **Infrastructure** (`src/infra/adapters/`): Repository implementations. In-memory mimics DynamoDB (dict storage, returns copies)
- **Presentation** (`src/cli/`): Streamlit UI (dev only). Initialize repo in `st.session_state` for persistence

## Key Patterns
- Repository interface in `src/domain/ports/`, implementations in `src/infra/adapters/repos/`
- Use cases execute business operations: `use_case.execute(data)`
- Export classes via `__all__` in `__init__.py`
