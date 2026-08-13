"""Application settings.

Master plan §20 specifies PostgreSQL + pgvector as the primary datastore. The
default here is SQLite so the suite runs with no services up; point
``DATABASE_URL`` at Postgres for anything real.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
    echo_sql: bool = os.getenv("ECHO_SQL", "").lower() in {"1", "true", "yes"}


settings = Settings()
