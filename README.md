# Recipe Manager

## Getting Started

### Prerequisites

- Python 3.13+
- [uv](https://github.com/astral-sh/uv) package manager
- Docker (optional, for containerized development)

### Installation

```bash
git clone <repository-url>
cd sam
cp .env.example .env
uv sync --group dev
```

## Development

### Run API Server (Local)

```bash
uv run uvicorn backend.src.main:app --reload
```

### Run Tests

```bash
uv run python tests/test_integration.py
```

## Docker

### Quick Start

```bash
# 1. Build the containers
docker compose build

# 2. Start the services (API + DynamoDB Local)
docker compose up

# 3. In another terminal, verify it's running
curl http://localhost:9000/health
# Expected: {"status":"ok","service":"recipes"}
```

### Common Commands

```bash
# Start in background (detached)
docker compose up -d

# View logs
docker compose logs -f api

# Stop all services
docker compose down

# Rebuild after code changes
docker compose up --build
```

## Project Structure

```
sam/
├── backend/src/       # Domain, use cases, infrastructure
├── frontend/          # Frontend
├── tests/             # Integration tests
├── docker-compose.yml # Local development orchestration
└── .env.example       # Environment template
```
