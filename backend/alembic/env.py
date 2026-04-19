import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine, pool

from src.infra.db import Base

# Load root .env (backend/../.env → repo root)
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def build_sync_url() -> str:
    """Build a synchronous PostgreSQL URL from env vars.

    Uses psycopg2 (sync) — not asyncpg — because Alembic is synchronous.
    """
    host = os.environ["POSTGRES_HOST"]
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ["POSTGRES_DB"]
    user = os.environ["POSTGRES_USER"]
    pwd = os.environ["POSTGRES_PASSWORD"]
    return f"postgresql://{user}:{pwd}@{host}:{port}/{db}"


def run_migrations_offline() -> None:
    """Run migrations without a live DB connection (generates SQL only)."""
    context.configure(
        url=build_sync_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB connection."""
    connectable = create_engine(
        build_sync_url(),
        poolclass=pool.NullPool,  # ← CRITICAL: no persistent connections
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
