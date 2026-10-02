"""Checks a module's own suite imports, so nineteen repos do not hand-write them.

PLATFORM_TODO §1 asked for exactly this: *"A test every module can import that
asserts a candidate-scoped endpoint refuses an unauthenticated request. A
shared check, because nineteen hand-written ones is nineteen chances to
forget."*

It does not take a list of routes. A list is one endpoint behind the day it is
written, and the endpoint it misses is the new one — the one nobody reviewed.
It walks the app instead, finds every route whose path or query names a
candidate, and asks each one as nobody and as somebody else. A route added next
month is checked by a test written today.

The query half is v0.11.0: until then a route like `/skill-graph/theta
?candidate=…` was invisible to this check and to the guard alike.

    from ai_core.testing import assert_refuses_strangers

    def test_every_candidate_route_refuses_strangers(client):
        assert_refuses_strangers(client, app)
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from ai_core.guard import QUERY_NAMES, ROLE_SCHEME_PREFIX, role_refusal
from ai_core.identity import Role
from ai_core.service import SCHEME_NAME as SERVICE_SCHEME

__all__ = [
    "Leak",
    "assert_refuses_strangers",
    "assert_service_only",
    "assert_staff_only",
    "candidate_scoped_routes",
    "leaks",
    "role_gated_routes",
    "service_routes",
]

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


def _query_scoped(app: Any, query: Sequence[str]) -> dict[tuple[str, str], list[str]]:
    """(method, path) -> the query parameters in `query` that the operation
    declares. From the OpenAPI document, for the same reason as below."""
    wanted = set(query)
    found: dict[tuple[str, str], list[str]] = {}
    openapi = getattr(app, "openapi", None)
    if not callable(openapi) or not wanted:
        return found
    for path, operations in (openapi().get("paths") or {}).items():
        for method, operation in operations.items():
            if method.upper() not in _HTTP_METHODS or not isinstance(operation, dict):
                continue
            names = [
                p["name"]
                for p in operation.get("parameters") or []
                if p.get("in") == "query" and p.get("name") in wanted
            ]
            if names:
                found[(method.upper(), path)] = names
    return found


def candidate_scoped_routes(
    app: Any,
    params: Sequence[str] = ("candidate_id",),
    query: Sequence[str] = QUERY_NAMES,
) -> list[tuple[str, str]]:
    """Every (method, path template) whose path names one of `params`, or
    whose query takes one of `query`.

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

    found.update(_query_scoped(app, query))
    return sorted(found, key=lambda pair: (pair[1], pair[0]))


def _fill(path: str, params: Iterable[str], candidate: str) -> str:
    scoped = set(params)
    return _PARAM.sub(lambda m: candidate if m.group(1) in scoped else OTHER_ID, path)


def leaks(
    client: Any,
    app: Any,
    *,
    params: Sequence[str] = ("candidate_id",),
    query: Sequence[str] = QUERY_NAMES,
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
    by_query = _query_scoped(app, query)
    for method, template in candidate_scoped_routes(app, params, query):
        if (method, template) in skipped:
            continue
        url = _fill(template, params, OWNER)
        if (method, template) in by_query:
            url += "?" + urlencode({name: OWNER for name in by_query[(method, template)]})
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
    query: Sequence[str] = QUERY_NAMES,
    skip: Iterable[tuple[str, str]] = (),
    expect_at_least: int = 1,
) -> list[tuple[str, str]]:
    """Fail with every leaking route named. Returns the routes it checked.

    `expect_at_least` guards the test itself: a module whose routes were all
    renamed away from `candidate_id` would otherwise pass by checking nothing.
    """
    checked = candidate_scoped_routes(app, params, query)
    assert len(checked) >= expect_at_least, (
        f"found {len(checked)} candidate-scoped routes, expected at least {expect_at_least} — "
        "a check that finds nothing to check passes by accident"
    )
    found = leaks(client, app, params=params, query=query, skip=skip)
    assert not found, "candidate-scoped routes that served a stranger:\n  " + "\n  ".join(
        str(leak) for leak in found
    )
    return checked


# ── v0.12.0: routes about nobody that are still not for everybody ─────────────
#
# Found the same way and for the same reason: from the OpenAPI document, where
# `require_role` and `require_service` each declare a security scheme. A staff
# route added next month is checked by the test a module writes today.


def _secured(app: Any) -> dict[tuple[str, str], list[str]]:
    """(method, path) -> the security scheme names its operation declares."""
    found: dict[tuple[str, str], list[str]] = {}
    openapi = getattr(app, "openapi", None)
    if not callable(openapi):
        return found
    for path, operations in (openapi().get("paths") or {}).items():
        for method, operation in operations.items():
            if method.upper() not in _HTTP_METHODS or not isinstance(operation, dict):
                continue
            names = [name for entry in operation.get("security") or [] for name in entry]
            if names:
                found[(method.upper(), path)] = names
    return found


def role_gated_routes(app: Any) -> dict[tuple[str, str], frozenset[Role]]:
    """Every (method, path template) behind `require_role`, with its roles."""
    gated: dict[tuple[str, str], frozenset[Role]] = {}
    for route, names in _secured(app).items():
        for name in names:
            if name.startswith(ROLE_SCHEME_PREFIX):
                roles = frozenset(Role(r) for r in name[len(ROLE_SCHEME_PREFIX) :].split("+"))
                gated[route] = gated.get(route, frozenset()) | roles
    return dict(sorted(gated.items(), key=lambda item: (item[0][1], item[0][0])))


def service_routes(app: Any) -> list[tuple[str, str]]:
    """Every (method, path template) behind `require_service`."""
    return sorted(
        (route for route, names in _secured(app).items() if SERVICE_SCHEME in names),
        key=lambda pair: (pair[1], pair[0]),
    )


def _ask(client: Any, method: str, url: str, headers: dict[str, str]) -> Any:
    kwargs: dict[str, Any] = {"headers": headers}
    if method in {"POST", "PUT", "PATCH"}:
        kwargs["json"] = {}
    return client.request(method, url, **kwargs)


def assert_staff_only(
    client: Any,
    app: Any,
    *,
    skip: Iterable[tuple[str, str]] = (),
    expect_at_least: int = 1,
) -> dict[tuple[str, str], frozenset[Role]]:
    """Every role-gated route refuses nobody, a student, and every role it does
    not name — and lets each role it does name past the gate.

    "Past the gate" means anything but 401 and the gate's own 403. A 404 or a
    422 is fine there: the fake ids and empty bodies this sends are meant to
    fail, just not at the door. The gate's 403 is told apart from a later one
    (the candidate guard refusing a placement officer an individual record) by
    its detail, `role_refusal(roles)`.
    """
    gated = role_gated_routes(app)
    skipped = set(skip)
    assert len(gated) >= expect_at_least, (
        f"found {len(gated)} role-gated routes, expected at least {expect_at_least} — "
        "a check that finds nothing to check passes by accident"
    )
    problems: list[str] = []
    for (method, template), roles in gated.items():
        if (method, template) in skipped:
            continue
        url = _PARAM.sub(OTHER_ID, template)
        refusal = role_refusal(tuple(roles))
        response = _ask(client, method, url, {})
        if response.status_code not in (401, 403):
            problems.append(f"{method} {template} answered {response.status_code} to nobody")
        for role in Role:
            response = _ask(client, method, url, {"X-Role": role.value, "X-Candidate-Id": STRANGER})
            refused_at_gate = response.status_code == 401 or (
                response.status_code == 403 and _detail(response) == refusal
            )
            if role in roles and refused_at_gate:
                problems.append(f"{method} {template} refused {role.value}, which it names")
            if role not in roles and response.status_code not in (401, 403):
                problems.append(
                    f"{method} {template} answered {response.status_code} to {role.value}"
                )
    assert not problems, "role-gated routes that got it wrong:\n  " + "\n  ".join(problems)
    return gated


def assert_service_only(
    client: Any,
    app: Any,
    *,
    skip: Iterable[tuple[str, str]] = (),
    expect_at_least: int = 1,
) -> list[tuple[str, str]]:
    """Every service-only route refuses a browser — signed in as anybody, admin
    included — and a wrong secret. An admin is a person, not a module.

    A refusal is 401 or 403: a route that is also candidate-scoped may turn
    "nobody" away at the candidate guard before the secret is read, and that
    is still the door shut.
    """
    routes = service_routes(app)
    skipped = set(skip)
    assert len(routes) >= expect_at_least, (
        f"found {len(routes)} service-only routes, expected at least {expect_at_least} — "
        "a check that finds nothing to check passes by accident"
    )
    callers = {
        "nobody": {},
        "an admin, with no secret": {"X-Role": "admin", "X-Candidate-Id": STRANGER},
        "a wrong secret": {"X-Service-Secret": "not-the-secret"},
    }
    problems: list[str] = []
    for method, template in routes:
        if (method, template) in skipped:
            continue
        url = _PARAM.sub(OWNER, template)
        for who, headers in callers.items():
            response = _ask(client, method, url, headers)
            if response.status_code not in (401, 403):
                problems.append(f"{method} {template} answered {response.status_code} to {who}")
    assert not problems, "service-only routes that served a caller:\n  " + "\n  ".join(problems)
    return routes


def _detail(response: Any) -> Any:
    try:
        return response.json().get("detail")
    except Exception:  # noqa: BLE001 - a non-JSON body has no detail
        return None
