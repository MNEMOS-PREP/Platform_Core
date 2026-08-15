"""One UTC helper, used everywhere.

This exists because of a bug that is guaranteed rather than likely. SQLite
stores a `DATETIME` as text and hands it back **naive**; Postgres with
`TIMESTAMPTZ` hands back **aware**. Any arithmetic that mixes the two —

    days = (datetime.now(UTC) - mastery.last_evidence_at).days

raises ``TypeError: can't subtract offset-naive and offset-aware datetimes``
on the default store and works fine on the one nobody has running. M04 §5.4
names this specifically, because the first thing it breaks is the decay run,
which is a nightly job whose failure nobody watches.

So: one function to get "now", one function to make anything comparable to it,
and one to take a difference in days. Every module uses these rather than
`datetime.now()`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta


def utcnow() -> datetime:
    """The current time, timezone-aware, UTC. The only clock this platform reads."""
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """Make a datetime comparable to :func:`utcnow`.

    A naive value is *assumed* UTC rather than local: everything this platform
    writes is written in UTC, so a naive value coming back is one that lost its
    tzinfo in the database, not one that was ever local. Assuming local here
    would silently shift every stored timestamp by the developer's offset —
    5.5 hours, in our case, which is enough to move a decay calculation by
    most of a day and enough to reorder two turns in a transcript.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def days_between(later: datetime, earlier: datetime) -> float:
    """Fractional days between two instants, either or both possibly naive.

    Fractional, not `.days`: the integer form floors, so everything inside the
    first 24 hours is zero and a decay curve does not begin to move until the
    day after. That reads as a bug in the curve when it is a bug in the
    subtraction.
    """
    delta: timedelta = as_utc(later) - as_utc(earlier)
    return delta.total_seconds() / 86_400.0


def isoformat(value: datetime) -> str:
    """UTC ISO-8601, for anything that crosses a wire or lands in a checksum."""
    return as_utc(value).isoformat()
