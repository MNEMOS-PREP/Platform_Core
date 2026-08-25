"""The model roster: every language model the platform calls, named once.

Nineteen modules will each want a route to a model. If each one hardcodes an id
we get the failure this package exists to prevent, in its most expensive form:
a model is deprecated, one module is updated, eighteen keep calling a dead id,
and each of them reports it as a different kind of outage.

This module is the single place a model id appears. A module says what KIND of
work it is doing; this says which model does that today.

── It is already true that this was needed ─────────────────────────────────────

M15 named `llama-3.1-8b-instant` for two of its three jobs. That model returns
404 on the account the platform actually uses — *"does not exist or you do not
have access to it"* — so those calls fail on every run, and the only place that
was written down was one module's `keys.txt`. `verify()` below exists so the
next such drift is a command anybody can run rather than a bug somebody hits.

── The seam ────────────────────────────────────────────────────────────────────

    a module knows        this file knows
    ──────────────        ───────────────
    "this is generation"  which model is the generation model today
    "this is extraction"  which model is cheap and fast enough today
    "I need a schema"     whether that model honours json_schema

A module names a TIER, never a model. Changing a tier's model here changes it
for every module at once, which is the entire point.

── What is deliberately NOT here ───────────────────────────────────────────────

Prompts, and per-job policy beyond the tier. A prompt is the module's argument
about its own domain — M01's probe prompt is about interviewing, M13's is about
rubrics — and centralising those would make this file the place every module
fights over. Transport and identity are shared; meaning is not.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Literal

__all__ = [
    "MODELS",
    "PROVIDERS",
    "RETIRED",
    "Model",
    "Provider",
    "Tier",
    "USER_AGENT",
    "model_for",
    "provider_for",
    "resolve",
    "verify",
]

#: Identifies the caller to the provider.
#:
#: Not cosmetic. Groq sits behind Cloudflare, and a default `Python-urllib/3.11`
#: User-Agent is answered with **HTTP 403, body `error code: 1010`** — a browser
#: -signature ban that reads exactly like a rejected API key. Two separate
#: modules have now lost time to it. Send this on every request.
USER_AGENT = "AI-Interviewer/1.0 (+https://github.com/MNEMOS-PREP)"

#: What kind of work a call is. A module picks one of these; it does not pick a
#: model. The names are the master plan's tiers (§47.1).
Tier = Literal["generation", "extraction", "classification", "guard"]


@dataclass(frozen=True)
class Provider:
    """An OpenAI-compatible chat endpoint and the keys that open it."""

    name: str
    base_url: str
    #: Checked in order. The plural form is a POOL — several providers rate-limit
    #: per key rather than per account, so a list of keys is a list of quota.
    key_env: tuple[str, ...]
    note: str = ""

    def keys(self) -> list[str]:
        """Every key configured for this provider, in declaration order."""
        found: list[str] = []
        for name in self.key_env:
            raw = os.getenv(name, "")
            found.extend(part.strip() for part in raw.split(",") if part.strip())
        return found

    def configured(self) -> bool:
        return bool(self.keys())


PROVIDERS: dict[str, Provider] = {
    "groq": Provider(
        name="groq",
        base_url="https://api.groq.com/openai/v1",
        key_env=("GROQ_API_KEYS", "GROQ_API_KEY"),
        note="Behind Cloudflare — see USER_AGENT.",
    ),
    "nvidia": Provider(
        name="nvidia",
        base_url="https://integrate.api.nvidia.com/v1",
        key_env=("NVIDIA_API_KEYS", "NVIDIA_API_KEY"),
        note=(
            "Keys are valid; the endpoint is unreachable from some networks — TCP 443 "
            "connects and the request then hangs until timeout. Left configured so it is "
            "one env var away where it does work."
        ),
    ),
}


@dataclass(frozen=True)
class Model:
    """One model, and the things a caller has to branch on.

    `json_schema` is the field that matters. A caller that asks for structured
    output from a model which does not enforce it gets prose back and has to
    parse it, which is the regex-over-model-output path every module is
    supposed to avoid. Knowing before the call is what makes that avoidable.
    """

    id: str
    provider: str
    #: Honours `response_format: {"type": "json_schema", ..., "strict": true}`.
    json_schema: bool
    #: Emits reasoning tokens that are billed and counted but not returned as
    #: content. A caller must budget `max_tokens` well above the visible answer
    #: or it gets an empty string and a full completion-token count.
    reasoning: bool = False
    note: str = ""


#: Verified against the live account on 2026-08-25 by listing `/models` and
#: issuing a real structured-output call to each. Anything not on this list has
#: not been checked, whatever a provider's documentation says.
MODELS: dict[str, Model] = {
    "openai/gpt-oss-120b": Model(
        id="openai/gpt-oss-120b",
        provider="groq",
        json_schema=True,
        reasoning=True,
        note="Best available for anything a student reads. ~2.3s for 3 grounded questions.",
    ),
    "openai/gpt-oss-20b": Model(
        id="openai/gpt-oss-20b",
        provider="groq",
        json_schema=True,
        reasoning=True,
        note="Half the latency of 120b and close on quality for extraction-shaped work.",
    ),
    "meta-llama/llama-prompt-guard-2-86m": Model(
        id="meta-llama/llama-prompt-guard-2-86m",
        provider="groq",
        json_schema=False,
        note="Prompt-injection classifier. Returns a label, not a conversation.",
    ),
    "meta-llama/llama-prompt-guard-2-22m": Model(
        id="meta-llama/llama-prompt-guard-2-22m",
        provider="groq",
        json_schema=False,
        note="Smaller guard. Use when the 86m is rate-limited.",
    ),
}


#: Ids that were in use and are NOT available on the platform's account.
#:
#: Kept rather than deleted, because a name with no record attached gets
#: re-added by the next person who reads it in a provider's docs. Each entry is
#: a thing somebody already tried.
RETIRED: dict[str, str] = {
    "llama-3.1-8b-instant": (
        "404 model_not_found on this account. Named by M15 for extraction and "
        "extraction_validation, so both calls fail on every run."
    ),
    "llama-3.3-70b-versatile": "404 model_not_found on this account.",
    "qwen/qwen3.6-27b": (
        "Listed by the account and reachable, but fails strict json_schema with "
        "`json_validate_failed` and an empty `failed_generation`."
    ),
}


#: Which model does each kind of work, today. **Change a line here and every
#: module changes with it.** That is what this file is for.
_TIER_MODEL: dict[str, str] = {
    "generation": "openai/gpt-oss-120b",
    "extraction": "openai/gpt-oss-20b",
    "classification": "openai/gpt-oss-20b",
    "guard": "meta-llama/llama-prompt-guard-2-86m",
}

#: Overrides the model for one tier across the whole platform, without an edit.
_TIER_ENV = {tier: f"AI_MODEL_{tier.upper()}" for tier in _TIER_MODEL}


def model_for(tier: Tier, *, job_env: str | None = None) -> str:
    """The model id for this kind of work.

    Resolution order, most specific first:

      1. `job_env` — one module's one job, e.g. `M01_MODEL_PROBES`. For the case
         where a single call needs something different and changing the tier
         would move nineteen modules to fix one.
      2. `AI_MODEL_<TIER>` — the tier, platform-wide.
      3. the table above.

    An id that is not in `MODELS` is returned anyway. This function's job is to
    say what was asked for, not to refuse an id a caller has a reason to want —
    but `resolve()` will report that nothing is known about it, and `verify()`
    will say whether it answers.
    """
    if job_env:
        override = os.getenv(job_env, "").strip()
        if override:
            return override
    override = os.getenv(_TIER_ENV.get(tier, ""), "").strip()
    if override:
        return override
    return _TIER_MODEL[tier]


def provider_for(model_id: str) -> Provider | None:
    """Which endpoint serves this model, or None if nothing here knows it."""
    known = MODELS.get(model_id)
    if known is None:
        return None
    return PROVIDERS.get(known.provider)


@dataclass
class Route:
    """Everything a transport needs to make one call, resolved in one place."""

    tier: str
    model: str
    provider: Provider | None = None
    profile: Model | None = None
    keys: list[str] = field(default_factory=list)
    #: Populated when this route cannot be used, in words a log line can carry.
    unusable: str | None = None

    def __bool__(self) -> bool:
        return self.unusable is None


def resolve(tier: Tier, *, job_env: str | None = None) -> Route:
    """The model, its endpoint and its keys — or a stated reason there is none.

    Never raises and never returns a half-usable route. A caller checks the
    truthiness once and degrades, which is Rule 2 at the smallest possible
    scale: no key narrows what a module can offer, and says so.
    """
    model_id = model_for(tier, job_env=job_env)

    if model_id in RETIRED:
        return Route(tier=tier, model=model_id, unusable=f"retired: {RETIRED[model_id]}")

    profile = MODELS.get(model_id)
    provider = PROVIDERS.get(profile.provider) if profile else None
    if provider is None:
        return Route(
            tier=tier,
            model=model_id,
            profile=profile,
            unusable=f"no provider known for {model_id!r}; add it to ai_core.models",
        )

    keys = provider.keys()
    if not keys:
        return Route(
            tier=tier,
            model=model_id,
            provider=provider,
            profile=profile,
            unusable=(
                f"no key for {provider.name}: set one of "
                f"{', '.join(provider.key_env)}"
            ),
        )

    return Route(tier=tier, model=model_id, provider=provider, profile=profile, keys=keys)


def verify(tier: Tier | None = None, *, timeout: float = 30.0) -> list[tuple[str, str]]:
    """Ask each provider whether the roster's models actually exist. Opens sockets.

    Never called by application code and never by a test — it is the command
    that would have caught `llama-3.1-8b-instant` going 404 in M15 the day it
    happened, instead of the model quietly failing on every run with the only
    record of its name sitting in one module's key file.

        python -c "from ai_core.models import verify; print(*verify(), sep='\\n')"

    Returns `(model_id, status)`, one per model this account should be able to
    reach, where status is "ok" or the reason it is not.
    """
    wanted = [model_for(tier)] if tier else sorted({model_for(t) for t in _TIER_MODEL})  # type: ignore[arg-type]
    results: list[tuple[str, str]] = []

    listings: dict[str, set[str] | str] = {}
    for name, provider in PROVIDERS.items():
        keys = provider.keys()
        if not keys:
            listings[name] = "no key configured"
            continue
        request = urllib.request.Request(
            f"{provider.base_url}/models",
            headers={
                "Authorization": f"Bearer {keys[0]}",
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read())
            listings[name] = {entry["id"] for entry in body.get("data", [])}
        except urllib.error.HTTPError as exc:
            listings[name] = f"HTTP {exc.code}"
        except Exception as exc:  # noqa: BLE001 - a probe reports, it does not raise
            listings[name] = f"{type(exc).__name__}: {exc}"

    for model_id in wanted:
        profile = MODELS.get(model_id)
        if profile is None:
            results.append((model_id, "not in MODELS"))
            continue
        listing = listings.get(profile.provider)
        if isinstance(listing, str):
            results.append((model_id, f"{profile.provider}: {listing}"))
        elif model_id in listing:
            results.append((model_id, "ok"))
        else:
            results.append((model_id, f"NOT SERVED by {profile.provider} on this account"))

    return results
