"""v0.12.0: `require_role`, `ai_core.service`, and the checks that find both.

Each shared check is tested twice: it passes an app that is right, and it FAILS
an app that is wrong. A check only ever seen passing has not been shown to
check anything.
"""

from __future__ import annotations

import threading
from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from ai_core import identity, service
from ai_core.guard import candidate_guard, require_role, role_refusal
from ai_core.identity import Principal, Role
from ai_core.testing import (
    assert_service_only,
    assert_staff_only,
    role_gated_routes,
    service_routes,
)

STAFF = (Role.admin, Role.placement_officer)
ADMIN_ONLY = require_role(Role.admin)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    identity.set_resolver(None)
    monkeypatch.setattr(identity, "AUTH_MODE", "dev")
    for name in service.SECRET_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(service.FILE_VAR, str(tmp_path / "service_secret"))
    yield
    identity.set_resolver(None)


def _app(*, gate_review: bool = True, gate_package: bool = True) -> FastAPI:
    router = APIRouter(prefix="/v1", dependencies=[Depends(candidate_guard())])
    review_deps = [Depends(require_role(*STAFF))] if gate_review else []

    @router.get("/review/queue", dependencies=review_deps)
    def queue():
        return []

    @router.post("/review/{item_id}/resolve")
    def resolve(item_id: str, body: dict, who: Annotated[Principal, Depends(ADMIN_ONLY)]):
        return {"by": who.subject}

    package_deps = [Depends(service.require_service)] if gate_package else []

    @router.get("/questions/{question_id}/package", dependencies=package_deps)
    def package(question_id: str):
        return {"key_points": ["the answer"]}

    @router.get("/questions/{question_id}")
    def question(question_id: str, request: Request):
        body = {"stem": "Why?"}
        if service.is_service(request):
            body["key_points"] = ["the answer"]
        return body

    @router.get("/health")
    def health():
        return {"ok": True}

    app = FastAPI()
    app.include_router(router)
    return app


def _as(role: Role, who: str = "someone") -> dict[str, str]:
    return {"X-Role": role.value, "X-Candidate-Id": who}


# ── require_role ──────────────────────────────────────────────────────────────


def test_nobody_is_told_to_sign_in_and_a_student_is_told_who_may():
    client = TestClient(_app())
    assert client.get("/v1/review/queue").status_code == 401
    refused = client.get("/v1/review/queue", headers=_as(Role.student))
    assert refused.status_code == 403
    assert refused.json()["detail"] == role_refusal(STAFF)
    assert "placement_officer" in refused.json()["detail"]


def test_each_named_role_gets_in_and_no_other_does():
    client = TestClient(_app())
    for role in Role:
        status = client.get("/v1/review/queue", headers=_as(role)).status_code
        assert (status == 200) is (role in STAFF), role


def test_the_handler_gets_the_principal_rather_than_a_name_from_the_body():
    client = TestClient(_app())
    response = client.post("/v1/review/x/resolve", json={}, headers=_as(Role.admin, "ops-1"))
    assert response.json() == {"by": "ops-1"}


def test_a_gate_nobody_can_pass_is_refused_at_definition():
    with pytest.raises(ValueError):
        require_role()


def test_the_roles_are_in_the_openapi_document():
    gated = role_gated_routes(_app())
    assert gated[("GET", "/v1/review/queue")] == frozenset(STAFF)
    assert gated[("POST", "/v1/review/{item_id}/resolve")] == frozenset({Role.admin})
    assert ("GET", "/v1/health") not in gated


def test_assert_staff_only_passes_a_gated_app():
    app = _app()
    checked = assert_staff_only(TestClient(app), app, expect_at_least=2)
    assert len(checked) == 2


def _ops_app() -> tuple[FastAPI, object]:
    gate = require_role(Role.admin)
    app = FastAPI()

    @app.get("/ops", dependencies=[Depends(gate)])
    def ops():
        return {}

    return app, gate


def test_assert_staff_only_fails_a_door_that_opens_for_everyone():
    """The document still says admin; the dependency no longer refuses."""
    app, gate = _ops_app()
    client = TestClient(app)
    assert_staff_only(client, app)
    app.dependency_overrides[gate] = lambda: None
    with pytest.raises(AssertionError, match="answered 200 to nobody"):
        assert_staff_only(client, app)


def test_assert_staff_only_fails_a_door_that_opens_for_nobody():
    app, gate = _ops_app()

    def refuse_all():
        raise HTTPException(status_code=403, detail=role_refusal((Role.admin,)))

    app.dependency_overrides[gate] = refuse_all
    with pytest.raises(AssertionError, match="refused admin, which it names"):
        assert_staff_only(TestClient(app), app)


def test_a_check_that_finds_no_gated_route_fails():
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"ok": True}

    with pytest.raises(AssertionError, match="passes by accident"):
        assert_staff_only(TestClient(app), app)


# ── ai_core.service ───────────────────────────────────────────────────────────


def test_a_fresh_machine_has_a_secret_without_anyone_configuring_one():
    first = service.secret()
    assert len(first) >= 32
    assert service.secret() == first
    assert service.secret_source().endswith("service_secret")


def test_two_modules_on_one_machine_share_it(tmp_path, monkeypatch):
    """Eight threads racing to create it all read the same value."""
    monkeypatch.setenv(service.FILE_VAR, str(tmp_path / "race" / "service_secret"))
    seen: list[str] = []
    barrier = threading.Barrier(8)

    def start():
        barrier.wait()
        seen.append(service.secret())

    threads = [threading.Thread(target=start) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(set(seen)) == 1 and seen[0]


def test_a_configured_secret_wins_and_m04s_old_name_still_counts(monkeypatch):
    monkeypatch.setenv("M04_SERVICE_SECRET", "from-keys-txt")
    assert service.secret() == "from-keys-txt"
    assert service.secret_source() == "M04_SERVICE_SECRET"
    monkeypatch.setenv("SERVICE_SECRET", "platform-wide")
    assert service.secret() == "platform-wide"


def test_a_blank_header_never_matches():
    assert not service.matches(None)
    assert not service.matches("")
    assert service.matches(service.secret())


def test_an_emptied_secret_file_refuses_rather_than_matching_blank(tmp_path, monkeypatch):
    path = tmp_path / "empty" / "service_secret"
    path.parent.mkdir()
    path.write_text("")
    monkeypatch.setenv(service.FILE_VAR, str(path))
    with pytest.raises(RuntimeError):
        service.secret()


def test_a_service_route_answers_a_module_and_nobody_else():
    client = TestClient(_app())
    url = "/v1/questions/q1/package"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=_as(Role.admin)).status_code == 401
    assert client.get(url, headers=service.headers()).status_code == 200


def test_a_shared_route_gives_a_module_more_than_a_browser():
    client = TestClient(_app())
    assert "key_points" not in client.get("/v1/questions/q1", headers=_as(Role.student)).json()
    assert "key_points" in client.get("/v1/questions/q1", headers=service.headers()).json()


def test_assert_service_only_passes_and_fails():
    app = _app()
    assert service_routes(app) == [("GET", "/v1/questions/{question_id}/package")]
    assert_service_only(TestClient(app), app)

    with pytest.raises(AssertionError, match="passes by accident"):
        open_app = _app(gate_package=False)
        assert_service_only(TestClient(open_app), open_app)
