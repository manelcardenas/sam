# syntax=docker/dockerfile:1

FROM python:3.13-slim AS base
# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /usr/local/bin/uv

# Python settings
# UV_LINK_MODE=copy Ensures packages are fully contained in .venv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

ENV PORT=9000
ENV HOST=0.0.0.0
ENV USE_DYNAMODB=false

WORKDIR /app

# Copy dependency files first
COPY pyproject.toml uv.lock ./

## Install production dependencies only
RUN uv sync --frozen --no-dev

COPY backend/ ./backend/

EXPOSE ${PORT}

CMD uv run uvicorn backend.src.main:app --host ${HOST} --port ${PORT}
