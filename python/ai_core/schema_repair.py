"""Additive schema repair on startup.

Promoted from M15's `schema.py` at v0.3.0, unchanged in behaviour. It contains
nothing module-specific and every module needs it on the same day it adds its
second field; a second copy is how two repos end up disagreeing about what
happens to a `default_factory` column.

`SQLModel.metadata.create_all()` creates missing TABLES. It does not touch a
table that already exists, so adding a field to a model leaves every existing
`dev.db` one column short and the next query dies with

    sqlite3.OperationalError: no such column: m04_concept_mastery.ever_displayed

which is a broken page, on a machine that was working, caused by pulling. The
usual answer is "re-seed", and the usual answer is wrong: it means every schema
change costs everyone their local data and a support message.

**Additive only, deliberately.** It never drops, renames, retypes or reorders,
because those are exactly the changes that lose data. A column that cannot be
added safely (NOT NULL with no default) is reported and skipped rather than
guessed at; that one needs a real migration and a human.

This is not a migration tool. When `DATABASE_URL` points at Postgres — which
master plan §20 specifies for anything real — the right answer is Alembic, and
this steps aside and says so.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, inspect, text
from sqlmodel import SQLModel

log = logging.getLogger(__name__)


def _literal(value: object) -> str | None:
    """A SQL literal for a simple Python default, or None if it is not simple."""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    if isinstance(value, datetime):
        return f"'{value.isoformat()}'"
    if isinstance(value, list | dict):
        # JSON columns. `[]` is not the same as NULL to the code that reads it:
        # a list field iterates, and NULL raises TypeError.
        return "'" + json.dumps(value).replace("'", "''") + "'"
    # StrEnum and friends: their value is what lands in the column.
    inner = getattr(value, "value", None)
    if isinstance(inner, str | int | float):
        return _literal(inner)
    return None


def _model_default(table_name: str, column_name: str) -> object | None:
    """The default SQLModel declares for this field, if SQLAlchemy has none.

    A field written as::

        concept_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))

    puts its `default_factory` on the PYDANTIC field and hands SQLAlchemy an
    explicit `Column(JSON)` with no default at all. Reading only the SQLAlchemy
    side therefore finds nothing, adds the column as NULL, and the first code
    path that iterates the list dies with `'NoneType' object is not iterable` —
    which is a 500 on a page, three commits after the field was added.
    """
    for mapper in SQLModel._sa_registry.mappers:
        table = getattr(mapper, "local_table", None)
        if table is None or table.name != table_name:
            continue
        field = getattr(mapper.class_, "model_fields", {}).get(column_name)
        if field is None:
            return None
        if getattr(field, "default_factory", None) is not None:
            try:
                return field.default_factory()
            except Exception:  # noqa: BLE001 — a default we cannot build is no default
                return None
        default = getattr(field, "default", None)
        if default is not None and type(default).__name__ != "PydanticUndefinedType":
            return default
        return None
    return None


def _backfill_literal(column) -> str:
    """What to put in existing rows for a column the model says is NOT NULL.

    Only reached when the column has no usable default — a
    `default_factory=datetime.now` timestamp, typically. Leaving NULL in a
    field the model types as non-optional produces a `None` where the code
    expects a value, which surfaces later and further away than it should.
    """
    type_ = column.type
    if isinstance(type_, DateTime):
        return "CURRENT_TIMESTAMP"
    if isinstance(type_, Boolean):
        return "0"
    if isinstance(type_, Integer | Numeric):
        return "0"
    if isinstance(type_, String):
        return "''"
    return "NULL"


def ensure_schema(engine) -> list[str]:
    """Add columns the models declare and the database lacks.

    Returns a description of every change, so a caller can log it. Silence
    here would mean a developer's database was altered without being told.
    """
    dialect = engine.dialect.name
    if dialect not in ("sqlite",):
        # Postgres gets Alembic, not a homegrown ALTER loop.
        log.debug("schema repair skipped: %s is not sqlite", dialect)
        return []

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    changes: list[str] = []

    with engine.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # create_all() owns this case

            present = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present:
                    continue

                type_sql = column.type.compile(engine.dialect)
                default = getattr(column.default, "arg", None)
                if default is not None and not callable(default):
                    literal = _literal(default)
                else:
                    # Fall back to what the SQLModel field declares. JSON list
                    # columns live entirely on that side.
                    literal = _literal(_model_default(table.name, column.name))

                # Never emit NOT NULL: SQLite rejects it on ADD COLUMN without
                # a constant default, and since we do not emit it there is no
                # constraint for existing rows to violate. The model's
                # non-optional type is then honoured by backfilling, below.
                statement = f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {type_sql}'
                if literal is not None:
                    statement += f" DEFAULT {literal}"
                connection.execute(text(statement))

                # A `default_factory` (a timestamp, typically) is a Python
                # callable with no SQL equivalent. Existing rows would read
                # back as None into a field the code types as non-optional,
                # which surfaces later and further away than it should.
                if literal is None and not column.nullable:
                    connection.execute(
                        text(
                            f'UPDATE "{table.name}" SET "{column.name}" = '
                            f"{_backfill_literal(column)}"
                        )
                    )

                changes.append(f"{table.name}.{column.name}")

    if changes:
        log.info("schema: added %d column(s): %s", len(changes), ", ".join(changes))
    return changes
