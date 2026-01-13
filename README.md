# Recipe Manager

## 🚀 Getting Started

### Prerequisites

- Python 3.13+
- [uv](https://github.com/astral-sh/uv) package manager

### Installation

1. Clone the repository

   ```bash
   git clone <repository-url>
   cd sam
   ```

2. Set up environment variables

   ```bash
   cp .env.example .env
   ```

   Then edit the `.env` file to add your OpenAI API key.

3. Install dependencies
   ```bash
   uv sync --dev
   ```

## 🧪 Development

### Run Streamlit UI (Local Development)

```bash
uv run streamlit run src/cli/streamlit_app.py
```

This opens a web interface where you can:

- 📋 List all recipes
- ➕ Add new recipes
- ✏️ Update existing recipes
- 🗑️ Delete recipes

**Note**: Streamlit is a **dev dependency** - only used for local testing. Data is stored in-memory and resets on restart.

### Run Integration Tests

```bash
uv run python tests/test_integration.py
```

## 🗄️ Data Storage

### Current: In-Memory

- Used for local development and testing
- Data resets on app restart
- No external dependencies

### Future: DynamoDB

- Swap `InMemoryRecipeRepository` with `DynamoDBRecipeRepository`
- No changes to domain or application layers
- Clean architecture makes this swap trivial
