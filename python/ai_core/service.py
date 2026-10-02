"""Calls with no student behind them — the shared secret, written once.

`ai_core.guard` answers "may this person have this student's data". Some calls
have no person: M13's outbox posting an observation to M04, M06 fetching the
interviewer's notes for a question from M05. Those are one module asking
another, and what proves it is a secret both hold.

── Why this is here and not in M04 ─────────────────────────────────────────────

M04 wrote the check first (`keys.py`) and three callers then each read the
secret their own way — M06's HTTP client, M13's `emit.py` and M15's theta
fetch — with two different variable names between them, which M06 and M13 had
both already patched around with a fallback list. Meanwhile M05 served its
answer key (every question's reference answer and key points) to anyone,
because it had no secret to check. A fact nineteen repos must agree on, held in
four copies: the case this package exists for.

── Where the secret comes from ─────────────────────────────────────────────────

1. `SERVICE_SECRET`, or M04's original name `M04_SERVICE_SECRET` — one line in
   each module's `keys.txt`, or a real environment variable in a deployment.
2. Otherwise a **machine secret**: a random value in a file under the user's
   home directory, created by whichever module asks first and read by the rest.

The second is the change. M04's rule was "no secret configured → service
routes OPEN, and say so loudly", because failing closed on a fresh clone would
make every sibling report M04 as broken. That traded the guarantee for
convenience, and a warning in one terminal tab of twelve is not read. Every
module on one machine reading one file keeps the convenience — a fresh clone
works with nothing configured — and drops the trade: there is never a moment
when the routes are open. Across machines the file differs, the call is
refused with a 401 that names the variable to set, and nothing leaks.

`AI_SERVICE_SECRET_FILE` moves the file (tests point it at a temp dir).
"""

from __future__ import annotations

import hmac
import os
import secrets
import time
from pathlib import Path

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader

__all__ = [
    "HEADER",
    "SCHEME_NAME",
    "SECRET_VARS",
    "headers",
    "is_service",
    "matches",
    "require_service",
    "secret",
    "secret_source",
]

#: Read in this order. `M04_SERVICE_SECRET` is the name M04 shipped with and
#: every `keys.txt` already has; `SERVICE_SECRET` is the platform's.
SECRET_VARS: tuple[str, ...] = ("SERVICE_SECRET", "M04_SERVICE_SECRET")
FILE_VAR = "AI_SERVICE_SECRET_FILE"
HEADER = "X-Service-Secret"
#: How a service-only route appears in the OpenAPI document — what
#: `ai_core.testing.assert_service_only` reads.
SCHEME_NAME = "service"


def _file() -> Path:
    override = os.getenv(FILE_VAR, "").strip()
    if override:
        return Path(override)
    return Path.home() / ".ai-interviewer" / "service_secret"


def _machine_secret(path: Path) -> str:
    """Read the machine secret, creating it if nobody has yet.

    Created with O_EXCL, so two modules starting at the same moment cannot
    both write one: the loser reads the winner's. It may read the file between
    the winner's create and write, so an empty read is retried briefly rather
    than taken as the value.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        deadline = time.monotonic() + 2.0
        while True:
            value = path.read_text(encoding="utf-8").strip()
            if value or time.monotonic() > deadline:
                return value
            time.sleep(0.05)
    value = secrets.token_urlsafe(32)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(value)
    return value


def secret() -> str:
    """The secret this process sends and expects. Never empty."""
    for name in SECRET_VARS:
        value = os.getenv(name, "").strip()
        if value:
            return value
    value = _machine_secret(_file())
    if not value:
        # An empty file someone else truncated. Refusing every call is right;
        # a blank secret that matches a blank header would not be.
        raise RuntimeError(f"{_file()} is empty; delete it or set SERVICE_SECRET")
    return value


def secret_source() -> str:
    """Where the secret came from — a variable NAME or a path, never the value.
    For a startup log line, so a 401 between two machines is explainable."""
    for name in SECRET_VARS:
        if os.getenv(name, "").strip():
            return name
    return str(_file())


def headers() -> dict[str, str]:
    """What a module sends when it calls another as itself."""
    return {HEADER: secret()}


def matches(presented: str | None) -> bool:
    """Constant-time, and an absent or blank header never matches."""
    if not presented:
        return False
    return hmac.compare_digest(presented.encode("utf-8"), secret().encode("utf-8"))


def is_service(request: Request) -> bool:
    """For a route that serves both: a module gets more than a browser does."""
    return matches(request.headers.get(HEADER))


_scheme = APIKeyHeader(
    name=HEADER,
    scheme_name=SCHEME_NAME,
    description=(
        "Module-to-module calls only. The value is SERVICE_SECRET (or "
        "M04_SERVICE_SECRET), else the machine secret every module on one host shares."
    ),
    auto_error=False,
)


def require_service(presented: str | None = Depends(_scheme)) -> None:
    """A FastAPI dependency for a route only another module may call."""
    if not matches(presented):
        raise HTTPException(
            status_code=401,
            detail=(
                "Service credentials required. A module calling this sends "
                f"{HEADER}; across machines, set SERVICE_SECRET to the same value on both."
            ),
        )
