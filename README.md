# Recipe Manager

## Getting Started

### Prerequisites

- Python 3.13+
- [uv](https://github.com/astral-sh/uv) package manager

### Installation

```bash
git clone <repository-url>
cd sam
cp .env.example .env
uv sync --all-groups
```

## Development

### Run Streamlit UI

```bash
uv run streamlit run frontend/cli/streamlit_app.py
```

### Run Tests

```bash
uv run python tests/test_integration.py
```

## Project Structure

```
sam/
├── backend/src/       # Domain, use cases, infrastructure
├── frontend/cli/      # Streamlit dev UI
└── tests/             # Integration tests
```
