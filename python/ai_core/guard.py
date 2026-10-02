"""The router-level check, written once — the enforcement half of `identity`.

v0.9.0 shipped the contract and said so: *"A contract nobody calls is not a
fix."* Three modules then called it, each with its own copy of the same
twenty-line dependency (M01, M02, M06), and four did not (M04, M05, M13, M15) —
including M04, which holds the skill graph and the consent records. The
copies were already starting to differ in what they did with a `session_id`.

So the dependency lives here and a module takes it in one line::

    router = APIRouter(prefix="/v1", dependencies=[Depends(candidate_guard())])

Declared on the ROUTER, it runs on every endpoint including the ones nobody
has written yet. A per-route check is the one somebody omits on the sixteenth
endpoint, and the sixteenth endpoint is the one that leaks.

── Four ways a route names a student ───────────────────────────────────────────

    /candidates/{candidate_id}/…   the path names them — handled by default
    /sessions/{session_id}/…       an id that BELONGS to a candidate — pass an
                                   `owners` resolver for that parameter
    /…?candidate=…                 the QUERY names them — handled by default
                                   (v0.11.0), for any name in `query`
    POST /… with candidate_id      the BODY names them — call
                                   `require_candidate()` in the handler; the
                                   guard cannot see a body it has not parsed

The query form was the gap until v0.11.0. M04's `GET /v1/skill-graph/theta
?candidate=…` sat behind a router-level guard that only read the path, so it
answered anybody holding the service secret about any student — and M15 called
it without saying who for. A guard that reads only some of the places a request
can name a student is a guard with a door it does not watch.

── Service callers forward, they do not assert ─────────────────────────────────

There is no `service` role and this file does not invent one: the list is
closed so the other eighteen modules know how to refuse every role that exists.
A module calling another on a student's behalf forwards that student's
identity — `identity_headers()` — exactly as M02 already does when it calls
M01. When a real resolver replaces the dev header, this is the one function
that changes. A call with no student behind it at all is `ai_core.service`.

── Routes about nobody, but not for everybody ──────────────────────────────────

A review queue, an operations log, a requeue button. They name no student, so
the guard above lets them through — and until v0.12.0 that is what happened:
M13's dispute queue and M15's whole `/admin/*` surface answered anybody, and M06
had written "Staff only." by hand twice. `require_role(...)` is that check,
once. It also puts the route's roles in the OpenAPI document (as a security
scheme named `role:<roles>`), which is how `ai_core.testing.assert_staff_only`
finds every gated route without being given a list.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader

from ai_core.identity import Principal, Role, may_see, principal_from_headers

__all__ = [
    "QUERY_NAMES",
    "ROLE_SCHEME_PREFIX",
    "candidate_guard",
    "identity_headers",
    "require_candidate",
    "require_role",
    "role_refusal",
]

#: Query parameters that name a student. Checked when the path names nobody.
QUERY_NAMES: tuple[str, ...] = ("candidate_id", "candidate")

#: Resolves an id found in the path to the candidate it belongs to. Returns
#: None when the id is unknown — the guard then lets the request through, and
#: the handler 404s. Refusing here would tell a caller which ids exist.
Owner = Callable[[str], str | None]


def candidate_guard(
    owners: Mapping[str, Owner] | None = None,
    *,
    param: str = "candidate_id",
    query: Sequence[str] = QUERY_NAMES,
) -> Callable[[Request], Principal | None]:
    """A FastAPI dependency: who is asking, and may they have this student?

    Returns the principal for handlers that want it. Raises 403 with the
    decision's reason — not 404: pretending a record does not exist would be a
    lie to the student it belongs to.
    """
    owners = dict(owners or {})

    def enforce_access(request: Request) -> Principal | None:
        principal = principal_from_headers(dict(request.headers))
        candidate = request.path_params.get(param)
        if candidate is None:
            for name, owner in owners.items():
                value = request.path_params.get(name)
                if value is None:
                    continue
                try:
                    candidate = owner(str(value))
                except Exception:  # noqa: BLE001 - a lookup failure is not permission
                    raise HTTPException(
                        status_code=403,
                        detail="Could not establish whose record this is.",
                    ) from None
                if candidate is not None:
                    break
        if candidate is None:
            # The path names nobody; the query may. Read after the path, so a
            # route that names its student in both is decided by the path.
            candidate = next(
                (request.query_params[name] for name in query if request.query_params.get(name)),
                None,
            )
        if candidate is None:
            return principal
        decision = may_see(principal, str(candidate))
        if not decision:
            raise HTTPException(status_code=403, detail=decision.reason)
        return principal

    return enforce_access


def require_candidate(principal: Principal | None, candidate_id: object) -> None:
    """The body-scoped half. Call before acting on a candidate named in a body."""
    decision = may_see(principal, str(candidate_id))
    if not decision:
        raise HTTPException(status_code=403, detail=decision.reason)


#: OpenAPI security-scheme names for role-gated routes start with this; the
#: rest is the allowed roles, sorted and joined with `+`.
ROLE_SCHEME_PREFIX = "role:"


def role_refusal(roles: Sequence[Role]) -> str:
    """The 403 a signed-in caller with the wrong role gets. Names who may."""
    return "Staff only: this needs " + " or ".join(sorted(r.value for r in roles)) + "."


def require_role(*roles: Role) -> Callable[..., Principal]:
    """A FastAPI dependency: refuse anybody whose role is not one of `roles`.

    401 for nobody — signing in would change the answer. 403 for a caller who
    is signed in with another role — signing in would not. Returns the
    principal, so a handler that records who acted (`resolved_by`) can take it
    instead of trusting a name in the body.

    Declare it on the route (`dependencies=[Depends(require_role(Role.admin))]`)
    or take it as a parameter; either way the route's OpenAPI entry carries
    `security: [{"role:<roles>": []}]`, which is the public statement of who
    may call it and what the shared test reads.
    """
    if not roles:
        raise ValueError("require_role needs at least one role; a gate nobody passes is a 404")
    allowed = frozenset(Role(r) for r in roles)
    scheme = APIKeyHeader(
        name="X-Role",
        scheme_name=ROLE_SCHEME_PREFIX + "+".join(sorted(r.value for r in allowed)),
        description=(
            "Signed-in role, one of: " + ", ".join(sorted(r.value for r in allowed)) + ". "
            "In development the X-Role and X-Candidate-Id headers name the caller "
            "(AI_AUTH_MODE=dev); a registered resolver replaces them."
        ),
        auto_error=False,
    )
    refusal = role_refusal(tuple(allowed))

    def require(request: Request, _declared: str | None = Depends(scheme)) -> Principal:
        # `_declared` is only there so the route documents its roles. Who is
        # asking is decided by the same resolver as everywhere else, from every
        # header — never from the one this scheme names.
        principal = principal_from_headers(dict(request.headers))
        if principal is None:
            raise HTTPException(status_code=401, detail="Not signed in.")
        if principal.role not in allowed:
            raise HTTPException(status_code=403, detail=refusal)
        return principal

    require.roles = allowed  # type: ignore[attr-defined]
    return require


def identity_headers(candidate_id: object) -> dict[str, str]:
    """What a module forwards when it calls another on this student's behalf.

    Captured at the time of the student's own request and replayed later by an
    outbox worker, the student is still the one asking — which is the point:
    the worker is carrying their request, not making its own.
    """
    return {"X-Role": "student", "X-Candidate-Id": str(candidate_id)}
