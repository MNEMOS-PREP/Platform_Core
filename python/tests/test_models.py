"""The model roster — checked without opening a socket.

`verify()` is the one function here that talks to a provider, and no test calls
it. The platform rule is that the whole suite runs offline on a marker's laptop
with no API key, and a roster test that needed a key would be the first thing to
break that.

What IS testable offline is the part that actually goes wrong: a tier pointing
at a model nobody described, an id sitting in both the live table and the
retired one, and a missing key raising instead of degrading.
"""

from __future__ import annotations

import pytest

from ai_core import models


@pytest.fixture(autouse=True)
def _no_ambient_config(monkeypatch):
    """A developer's real keys must not change what these assert.

    Without this the suite passes or fails depending on whose machine it runs
    on, which is the property a test is supposed to remove.
    """
    for provider in models.PROVIDERS.values():
        for name in provider.key_env:
            monkeypatch.delenv(name, raising=False)
    for tier in ("generation", "extraction", "classification", "guard"):
        monkeypatch.delenv(f"AI_MODEL_{tier.upper()}", raising=False)


# ---------------------------------------------------------------------------
#  The table is internally consistent
# ---------------------------------------------------------------------------


def test_every_tier_points_at_a_model_the_roster_describes():
    """A tier naming an id with no profile is the failure this file prevents.

    `resolve()` would hand back a route with no provider, and the caller would
    report it as "no key" — sending somebody to check their credentials for a
    typo in a dict.
    """
    for tier in ("generation", "extraction", "classification", "guard"):
        model_id = models.model_for(tier)
        assert model_id in models.MODELS, f"tier {tier!r} points at unknown {model_id!r}"


def test_every_model_names_a_provider_that_exists():
    for model in models.MODELS.values():
        assert model.provider in models.PROVIDERS, f"{model.id} names provider {model.provider!r}"


def test_no_model_is_both_live_and_retired():
    """Retiring an id without removing it from the roster is how a dead model
    goes on being selected while a comment two screens away says it is dead."""
    overlap = sorted(set(models.MODELS) & set(models.RETIRED))
    assert not overlap, f"listed as both usable and retired: {overlap}"


def test_a_structured_output_caller_can_tell_before_calling():
    """`json_schema` is the field callers branch on, so at least one model that
    honours it has to exist — otherwise every structured call is parsing prose."""
    assert any(m.json_schema for m in models.MODELS.values())


# ---------------------------------------------------------------------------
#  Selection
# ---------------------------------------------------------------------------


def test_a_tier_override_moves_every_module_at_once():
    """The whole reason this file exists: one env var, nineteen modules."""
    assert models.model_for("generation") == "openai/gpt-oss-120b"


def test_env_overrides_beat_the_table(monkeypatch):
    monkeypatch.setenv("AI_MODEL_GENERATION", "some/other-model")
    assert models.model_for("generation") == "some/other-model"


def test_a_job_override_beats_the_tier(monkeypatch):
    """One module's one call, without moving the tier under eighteen others."""
    monkeypatch.setenv("AI_MODEL_GENERATION", "tier/model")
    monkeypatch.setenv("M01_MODEL_PROBES", "job/model")

    assert models.model_for("generation") == "tier/model"
    assert models.model_for("generation", job_env="M01_MODEL_PROBES") == "job/model"


def test_an_unset_job_override_falls_through(monkeypatch):
    """An empty env var is not a choice. It is an unset one spelled differently,
    and treating it as a model id resolves the tier to the empty string."""
    monkeypatch.setenv("M01_MODEL_PROBES", "")
    assert models.model_for("generation", job_env="M01_MODEL_PROBES") == "openai/gpt-oss-120b"


# ---------------------------------------------------------------------------
#  Resolution degrades; it never raises
# ---------------------------------------------------------------------------


def test_no_key_is_a_stated_reason_rather_than_an_exception():
    """Rule 2 at the smallest scale. A module with no key drops the feature and
    says which key would bring it back — it does not 500."""
    route = models.resolve("generation")

    assert not route
    assert route.unusable
    assert "GROQ_API_KEYS" in route.unusable


def test_a_key_makes_the_route_usable(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "test-key-1,test-key-2")
    route = models.resolve("generation")

    assert route
    assert route.unusable is None
    assert route.keys == ["test-key-1", "test-key-2"]
    assert route.provider is not None
    assert route.profile is not None and route.profile.json_schema


def test_a_key_pool_is_split_on_commas_and_stripped(monkeypatch):
    """Several providers rate-limit per key, so a pool is a pool of quota.
    Whitespace round a comma is how a hand-edited key file usually looks."""
    monkeypatch.setenv("GROQ_API_KEYS", " a , b ,, c ")
    assert models.PROVIDERS["groq"].keys() == ["a", "b", "c"]


def test_a_retired_model_is_refused_with_the_reason_it_was_retired(monkeypatch):
    """This is the M15 case, as a test.

    `llama-3.1-8b-instant` was named for two jobs and 404s on the account. A
    module selecting it should be told that, not left to read a 404 from a
    provider and wonder whether its key is wrong.
    """
    monkeypatch.setenv("GROQ_API_KEYS", "test-key")
    monkeypatch.setenv("AI_MODEL_EXTRACTION", "llama-3.1-8b-instant")

    route = models.resolve("extraction")

    assert not route
    assert route.unusable is not None
    assert "retired" in route.unusable
    assert "404" in route.unusable


def test_an_unknown_model_says_where_to_add_it(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEYS", "test-key")
    monkeypatch.setenv("AI_MODEL_GENERATION", "nobody/knows-this")

    route = models.resolve("generation")

    assert not route
    assert route.unusable is not None
    assert "ai_core.models" in route.unusable


def test_the_user_agent_is_not_left_to_urllib():
    """Groq sits behind Cloudflare, which answers a default `Python-urllib/3.x`
    with 403 and body `error code: 1010` — a browser-signature ban that reads
    exactly like a rejected key. Two modules have lost time to it."""
    assert models.USER_AGENT
    assert "urllib" not in models.USER_AGENT.lower()
