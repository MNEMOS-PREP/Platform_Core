"""Cross-module dependency probing and graceful degradation.

Every module in this platform depends on a few others and is depended on by a
few more. In development, and often in the pilot, some of them will not be
running. The rule that follows is the platform's Rule 2 applied to services
rather than to students:

    **A missing dependency narrows the SCOPE of what we show, never the
    quality, and never silently.**

So a module never crashes because an upstream is down. It drops the feature
that needed it, says which module is missing and what that costs, and renders
everything else normally. The student is told "this needs M04, which isn't
running" — not shown a spinner forever, and never shown a fabricated
stand-in.

Usage in a module::

    from ai_core.dependencies import DependencyRegistry

    deps = DependencyRegistry.from_manifest("module.json")

    if deps.is_available("M04"):
        theta = fetch_theta(candidate_id)
    else:
        theta = None          # the feature degrades, the page still renders

    page.degraded = deps.degraded()
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

#: How long a probe result is trusted before we ask again. Short enough that a
#: teammate starting a module mid-session sees it appear; long enough that we
#: are not issuing a request per page view.
DEFAULT_CACHE_SECONDS = 30

#: Probes must be fast. A dependency that is slow to answer is treated the same
#: as one that is down — we will not make a student wait on it.
DEFAULT_TIMEOUT_SECONDS = 1.5


@dataclass(frozen=True)
class Dependency:
    """One upstream module this module can use."""

    module_id: str
    name: str
    #: What we use it for, in developer terms.
    reason: str
    #: What the student loses when it is missing, in their words.
    on_missing: str
    base_url: str
    health_path: str = "/health"
    #: `True` only if the module genuinely cannot function without it. Prefer
    #: False: a hard dependency turns someone else's outage into your outage.
    required: bool = False

    @property
    def health_url(self) -> str:
        return f"{self.base_url.rstrip('/')}{self.health_path}"


class DependencyStatus(BaseModel):
    """A dependency's health, as reported to callers and to the UI."""

    module_id: str
    name: str
    available: bool
    required: bool
    reason: str
    on_missing: str
    base_url: str
    checked_at: datetime
    detail: str


class DegradedFeature(BaseModel):
    """A feature that is switched off because an upstream is missing.

    This is what the UI renders as an honest banner rather than an empty box.
    """

    feature: str
    needs_module: str
    needs_module_name: str
    explanation: str


@dataclass
class DependencyRegistry:
    """Probes upstream modules and reports what is degraded."""

    dependencies: list[Dependency] = field(default_factory=list)
    cache_seconds: int = DEFAULT_CACHE_SECONDS
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    #: module_id -> (checked_at_monotonic, available, detail)
    _cache: dict[str, tuple[float, bool, str]] = field(default_factory=dict, repr=False)

    # ------------------------------------------------------------------ load

    @classmethod
    def from_manifest(cls, path: str | Path, **kwargs) -> DependencyRegistry:
        """Build from a `module.json` manifest.

        Env overrides let a developer point at a running instance without
        editing the manifest::

            M04_BASE_URL=http://127.0.0.1:8104
        """
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        deps: list[Dependency] = []
        for raw in data.get("depends_on", []):
            module_id = raw["module"]
            base_url = os.getenv(f"{module_id}_BASE_URL", raw.get("base_url", ""))
            deps.append(
                Dependency(
                    module_id=module_id,
                    name=raw.get("name", module_id),
                    reason=raw.get("reason", ""),
                    on_missing=raw.get("on_missing", ""),
                    base_url=base_url,
                    health_path=raw.get("health_path", "/health"),
                    required=bool(raw.get("required", False)),
                )
            )
        return cls(dependencies=deps, **kwargs)

    def get(self, module_id: str) -> Dependency | None:
        return next((d for d in self.dependencies if d.module_id == module_id), None)

    # ----------------------------------------------------------------- probe

    def _probe(self, dep: Dependency) -> tuple[bool, str]:
        if not dep.base_url:
            return False, "no base_url configured"
        try:
            request = urllib.request.Request(dep.health_url, method="GET")
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                if 200 <= response.status < 300:
                    return True, f"healthy ({response.status})"
                return False, f"unhealthy ({response.status})"
        except urllib.error.HTTPError as exc:
            return False, f"unhealthy ({exc.code})"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return False, f"unreachable ({type(exc).__name__})"

    def is_available(self, module_id: str, *, force: bool = False) -> bool:
        """Is this upstream usable right now? Cached, and never raises."""
        dep = self.get(module_id)
        if dep is None:
            return False

        cached = self._cache.get(module_id)
        if cached and not force and (time.monotonic() - cached[0]) < self.cache_seconds:
            return cached[1]

        available, detail = self._probe(dep)
        self._cache[module_id] = (time.monotonic(), available, detail)
        return available

    def statuses(self, *, force: bool = False) -> list[DependencyStatus]:
        """Health of every declared dependency."""
        out: list[DependencyStatus] = []
        for dep in self.dependencies:
            available = self.is_available(dep.module_id, force=force)
            detail = self._cache.get(dep.module_id, (0.0, available, ""))[2]
            out.append(
                DependencyStatus(
                    module_id=dep.module_id,
                    name=dep.name,
                    available=available,
                    required=dep.required,
                    reason=dep.reason,
                    on_missing=dep.on_missing,
                    base_url=dep.base_url,
                    checked_at=datetime.now(UTC),
                    detail=detail,
                )
            )
        return out

    def degraded(self, *, force: bool = False) -> list[DegradedFeature]:
        """Features currently switched off, and why.

        Attach this to any response whose completeness depends on an upstream,
        so the UI can say what is missing instead of rendering a mystery gap.
        """
        return [
            DegradedFeature(
                feature=dep.on_missing.split("—")[0].strip() or dep.name,
                needs_module=dep.module_id,
                needs_module_name=dep.name,
                explanation=dep.on_missing,
            )
            for dep in self.dependencies
            if not self.is_available(dep.module_id, force=force)
        ]

    def missing_required(self, *, force: bool = False) -> list[Dependency]:
        """Required upstreams that are down.

        Prefer an empty list forever: mark a dependency `required` only when the
        module genuinely cannot do its job without it, because doing so turns
        someone else's outage into yours.
        """
        return [
            dep
            for dep in self.dependencies
            if dep.required and not self.is_available(dep.module_id, force=force)
        ]

    def clear_cache(self) -> None:
        self._cache.clear()
