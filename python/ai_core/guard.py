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
that changes.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence

from fastapi import HTTPException, Request

from ai_core.identity import Principal, may_see, principal_from_headers

__all__ = ["QUERY_NAMES", "candidate_guard", "identity_headers", "require_candidate"]

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


def identity_headers(candidate_id: object) -> dict[str, str]:
    """What a module forwards when it calls another on this student's behalf.

    Captured at the time of the student's own request and replayed later by an
    outbox worker, the student is still the one asking — which is the point:
    the worker is carrying their request, not making its own.
    """
    return {"X-Role": "student", "X-Candidate-Id": str(candidate_id)}
