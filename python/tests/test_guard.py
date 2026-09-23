"""The router guard and the check that finds routes it should be guarding.

The second half is the one that matters long-term: a module adopting the guard
is checked by a test that discovers its routes rather than listing them, so the
route added next month is covered by a test written today.
"""

from __future__ import annotations

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from ai_core import identity
from ai_core.guard import candidate_guard, identity_headers, require_candidate
from ai_core.identity import Principal, Role
from ai_core.testing import assert_refuses_strangers, candidate_scoped_routes, leaks

OWNER = "00000000-0000-4000-8000-00000000a11c"
SESSION = "5e5510a0-0000-4000-8000-000000000001"


@pytest.fixture(autouse=True)
def _dev_mode(monkeypatch):
    identity.set_resolver(None)
    monkeypatch.setattr(identity, "AUTH_MODE", "dev")
    yield
    identity.set_resolver(None)


def _app(guarded: bool = True) -> FastAPI:
    owners = {"session_id": lambda sid: OWNER if sid == SESSION else None}
    deps = [Depends(candidate_guard(owners))] if guarded else []
    router = APIRouter(prefix="/v1", dependencies=deps)

    @router.get("/candidates/{candidate_id}/graph")
    def graph(candidate_id: str):
        return {"candidate_id": candidate_id}

    @router.post("/candidates/{candidate_id}/consent")
    def consent(candidate_id: str, body: dict):
        return {"ok": True}

    @router.get("/sessions/{session_id}/report")
    def report(session_id: str):
        return {"session_id": session_id}

    @router.get("/health")
    def health():
        return {"ok": True}

    app = FastAPI()
    app.include_router(router)
    return app


def test_the_owner_gets_their_own_record():
    client = TestClient(_app())
    response = client.get(f"/v1/candidates/{OWNER}/graph", headers=identity_headers(OWNER))
    assert response.status_code == 200


def test_nobody_is_refused_with_a_reason():
    response = TestClient(_app()).get(f"/v1/candidates/{OWNER}/graph")
    assert response.status_code == 403
    assert response.json()["detail"] == "Not signed in."


def test_an_id_that_belongs_to_a_candidate_is_resolved_before_deciding():
    client = TestClient(_app())
    assert client.get(f"/v1/sessions/{SESSION}/report").status_code == 403
    ok = client.get(f"/v1/sessions/{SESSION}/report", headers=identity_headers(OWNER))
    assert ok.status_code == 200


def test_an_unknown_id_is_left_for_the_handler_rather_than_confirmed():
    """Refusing here would tell a caller which session ids exist."""
    response = TestClient(_app()).get("/v1/sessions/not-a-session/report")
    assert response.status_code == 200  # the fake handler; a real one 404s


def test_a_lookup_that_fails_is_not_permission():
    def broken(_sid):
        raise RuntimeError("db down")

    router = APIRouter(dependencies=[Depends(candidate_guard({"session_id": broken}))])

    @router.get("/sessions/{session_id}")
    def read(session_id: str):
        return {}

    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get(f"/sessions/{SESSION}").status_code == 403


def test_meta_routes_name_nobody_and_are_open():
    assert TestClient(_app()).get("/v1/health").status_code == 200


def test_require_candidate_refuses_a_body_about_somebody_else():
    other = Principal(subject="x", role=Role.student, candidate_id="someone-else")
    with pytest.raises(Exception) as excinfo:
        require_candidate(other, OWNER)
    assert getattr(excinfo.value, "status_code", None) == 403


def test_forwarded_headers_resolve_to_the_same_student():
    principal = identity.principal_from_headers(identity_headers(OWNER))
    assert principal is not None and principal.is_self(OWNER)


# ─────────────────────────────────────────────────────────────────────────
#  ai_core.testing
# ─────────────────────────────────────────────────────────────────────────


def test_routes_are_discovered_not_listed():
    found = candidate_scoped_routes(_app(), params=("candidate_id",))
    assert set(found) == {
        ("GET", "/v1/candidates/{candidate_id}/graph"),
        ("POST", "/v1/candidates/{candidate_id}/consent"),
    }
    # An owner-resolved noun is found when asked for.
    assert ("GET", "/v1/sessions/{session_id}/report") in candidate_scoped_routes(
        _app(), params=("candidate_id", "session_id")
    )


def test_a_guarded_app_passes():
    app = _app()
    checked = assert_refuses_strangers(TestClient(app), app)
    assert len(checked) == 2


def test_an_unguarded_app_fails_with_every_route_named():
    """The check has to be able to fail, or it is decoration."""
    app = _app(guarded=False)
    found = leaks(TestClient(app), app)

    assert {(leak.method, leak.path) for leak in found} == {
        ("GET", "/v1/candidates/{candidate_id}/graph"),
        ("POST", "/v1/candidates/{candidate_id}/consent"),
    }
    assert {leak.asked_as for leak in found} == {"nobody", "another student"}
    with pytest.raises(AssertionError, match="served a stranger"):
        assert_refuses_strangers(TestClient(app), app)


def test_a_check_that_finds_nothing_to_check_fails():
    app = FastAPI()
    with pytest.raises(AssertionError, match="passes by accident"):
        assert_refuses_strangers(TestClient(app), app)
