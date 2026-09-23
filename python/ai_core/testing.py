"""Checks a module's own suite imports, so nineteen repos do not hand-write them.

PLATFORM_TODO §1 asked for exactly this: *"A test every module can import that
asserts a candidate-scoped endpoint refuses an unauthenticated request. A
shared check, because nineteen hand-written ones is nineteen chances to
forget."*

It does not take a list of routes. A list is one endpoint behind the day it is
written, and the endpoint it misses is the new one — the one nobody reviewed.
It walks the app instead, finds every route whose path names a candidate, and
asks each one as nobody and as somebody else. A route added next month is
checked by a test written today.

    from ai_core.testing import assert_refuses_strangers

    def test_every_candidate_route_refuses_strangers(client):
        assert_refuses_strangers(client, app)
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

__all__ = ["Leak", "assert_refuses_strangers", "candidate_scoped_routes", "leaks"]

_PARAM = re.compile(r"\{([^}:]+)(?::[^}]+)?\}")
_SKIP_METHODS = {"HEAD", "OPTIONS"}
_HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}

#: Deterministic, so a failure message is reproducible.
OWNER = "00000000-0000-4000-8000-00000000a11c"
STRANGER = "00000000-0000-4000-8000-0000000b0b00"
OTHER_ID = "00000000-0000-4000-8000-000000000123"


@dataclass(frozen=True)
class Leak:
    method: str
    path: str
    asked_as: str
    status: int

    def __str__(self) -> str:
        return f"{self.method} {self.path} answered {self.status} to {self.asked_as}"


def candidate_scoped_routes(
    app: Any, params: Sequence[str] = ("candidate_id",)
) -> list[tuple[str, str]]:
    """Every (method, path template) whose path names one of `params`.

    Read from the app's OpenAPI document rather than from `app.routes`. The
    route tree is FastAPI's internals and changed shape in 0.14x (included
    routers stopped being flattened, so a walk of `app.routes` found nothing
    and every module would have passed by checking nothing). The OpenAPI
    paths are the public contract and the same list a sibling module reads.

    A route hidden with `include_in_schema=False` is not seen. That is a
    route a module chose to hide from its own contract, and the flat walk
    below still catches it on FastAPI versions that flatten.
    """
    wanted = set(params)
    found: set[tuple[str, str]] = set()

    openapi = getattr(app, "openapi", None)
    if callable(openapi):
        for path, operations in (openapi().get("paths") or {}).items():
            if not set(_PARAM.findall(path)) & wanted:
                continue
            for method in operations:
                if method.upper() in _HTTP_METHODS:
                    found.add((method.upper(), path))

    for route in getattr(app, "routes", []):
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if path and methods and set(_PARAM.findall(path)) & wanted:
            found.update((method, path) for method in set(methods) - _SKIP_METHODS)

    return sorted(found, key=lambda pair: (pair[1], pair[0]))


def _fill(path: str, params: Iterable[str], candidate: str) -> str:
    scoped = set(params)
    return _PARAM.sub(lambda m: candidate if m.group(1) in scoped else OTHER_ID, path)


def leaks(
    client: Any,
    app: Any,
    *,
    params: Sequence[str] = ("candidate_id",),
    skip: Iterable[tuple[str, str]] = (),
) -> list[Leak]:
    """Every candidate-scoped route that did not refuse a stranger.

    Two strangers per route: nobody at all, and a signed-in student asking
    about somebody else. A refusal is 401 or 403. Anything else — including a
    404 or a 422 — means the request got past the guard, which is the leak even
    when this particular request happened to fail for another reason.
    """
    skipped = set(skip)
    found: list[Leak] = []
    strangers = {
        "nobody": {},
        "another student": {"X-Role": "student", "X-Candidate-Id": STRANGER},
    }
    for method, template in candidate_scoped_routes(app, params):
        if (method, template) in skipped:
            continue
        url = _fill(template, params, OWNER)
        for who, headers in strangers.items():
            kwargs: dict[str, Any] = {"headers": headers}
            if method in {"POST", "PUT", "PATCH"}:
                kwargs["json"] = {}
            response = client.request(method, url, **kwargs)
            if response.status_code not in (401, 403):
                found.append(Leak(method, template, who, response.status_code))
    return found


def assert_refuses_strangers(
    client: Any,
    app: Any,
    *,
    params: Sequence[str] = ("candidate_id",),
    skip: Iterable[tuple[str, str]] = (),
    expect_at_least: int = 1,
) -> list[tuple[str, str]]:
    """Fail with every leaking route named. Returns the routes it checked.

    `expect_at_least` guards the test itself: a module whose routes were all
    renamed away from `candidate_id` would otherwise pass by checking nothing.
    """
    checked = candidate_scoped_routes(app, params)
    assert len(checked) >= expect_at_least, (
        f"found {len(checked)} candidate-scoped routes, expected at least {expect_at_least} — "
        "a check that finds nothing to check passes by accident"
    )
    found = leaks(client, app, params=params, skip=skip)
    assert not found, "candidate-scoped routes that served a stranger:\n  " + "\n  ".join(
        str(leak) for leak in found
    )
    return checked
