"""Dependency probing and graceful degradation."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from ai_core.dependencies import Dependency, DependencyRegistry


class _Handler(BaseHTTPRequestHandler):
    status = 200

    def do_GET(self):  # noqa: N802 — http.server's required name
        self.send_response(type(self).status)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, *args):
        pass


@pytest.fixture
def live_server():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def _registry(base_url: str, **kwargs) -> DependencyRegistry:
    return DependencyRegistry(
        dependencies=[
            Dependency(
                module_id="M04",
                name="Skill Graph & MNEMOS Memory",
                reason="candidate theta per topic",
                on_missing="Your preparation — needs M04 to compare you against this drive",
                base_url=base_url,
            )
        ],
        **kwargs,
    )


def test_reachable_dependency_is_available(live_server):
    assert _registry(live_server).is_available("M04") is True


def test_unreachable_dependency_is_unavailable_and_does_not_raise():
    # Nothing listens here; the probe must fail closed, quietly and quickly.
    reg = _registry("http://127.0.0.1:1", timeout_seconds=0.3)
    assert reg.is_available("M04") is False


def test_unknown_module_is_unavailable():
    assert _registry("http://127.0.0.1:1").is_available("M99") is False


def test_missing_base_url_is_unavailable():
    reg = DependencyRegistry(
        dependencies=[
            Dependency("M04", "Skill Graph", "theta", "prep unavailable", base_url="")
        ]
    )
    assert reg.is_available("M04") is False
    assert "no base_url" in reg.statuses()[0].detail


def test_results_are_cached(live_server):
    reg = _registry(live_server, cache_seconds=999)
    assert reg.is_available("M04") is True
    # Point it somewhere dead; the cached answer should still be used.
    reg.dependencies[0] = Dependency(
        "M04", "Skill Graph", "theta", "prep unavailable", base_url="http://127.0.0.1:1"
    )
    assert reg.is_available("M04") is True
    assert reg.is_available("M04", force=True) is False


def test_degraded_lists_what_is_off_and_why():
    reg = _registry("http://127.0.0.1:1", timeout_seconds=0.3)
    degraded = reg.degraded()
    assert len(degraded) == 1
    assert degraded[0].needs_module == "M04"
    assert degraded[0].feature == "Your preparation"
    assert "M04" in degraded[0].explanation


def test_nothing_degraded_when_everything_is_up(live_server):
    assert _registry(live_server).degraded() == []


def test_optional_dependency_is_never_missing_required():
    """An optional upstream being down must not read as a module failure.

    Marking a dependency required turns someone else's outage into yours, so
    the default is optional and this is the guard on that default.
    """
    reg = _registry("http://127.0.0.1:1", timeout_seconds=0.3)
    assert reg.missing_required() == []
    assert reg.degraded() != []


def test_required_dependency_is_reported_when_down():
    reg = DependencyRegistry(
        dependencies=[
            Dependency(
                "M04", "Skill Graph", "theta", "prep unavailable",
                base_url="http://127.0.0.1:1", required=True,
            )
        ],
        timeout_seconds=0.3,
    )
    assert [d.module_id for d in reg.missing_required()] == ["M04"]


def test_from_manifest_reads_module_json(tmp_path, monkeypatch):
    manifest = tmp_path / "module.json"
    manifest.write_text(
        json.dumps(
            {
                "module": "M15",
                "depends_on": [
                    {
                        "module": "M04",
                        "name": "Skill Graph",
                        "reason": "theta",
                        "on_missing": "Your preparation — needs M04",
                        "base_url": "http://127.0.0.1:8104",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    reg = DependencyRegistry.from_manifest(manifest)
    assert [d.module_id for d in reg.dependencies] == ["M04"]
    assert reg.get("M04").base_url == "http://127.0.0.1:8104"

    # Env override lets a developer repoint without editing the manifest.
    monkeypatch.setenv("M04_BASE_URL", "http://127.0.0.1:9999")
    assert DependencyRegistry.from_manifest(manifest).get("M04").base_url == (
        "http://127.0.0.1:9999"
    )


def test_status_payload_carries_the_student_facing_explanation():
    reg = _registry("http://127.0.0.1:1", timeout_seconds=0.3)
    status = reg.statuses()[0]
    assert status.available is False
    assert status.required is False
    assert status.on_missing.startswith("Your preparation")
    assert status.checked_at is not None
