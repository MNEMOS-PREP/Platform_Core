"""The five states, decay and hysteresis (M04 §5.3, §6.5, AC-4.2).

These are the platform's most-copied numbers, so they are tested here rather
than in M04: a module that caches someone else's mastery still renders the
five states, and it renders them with this code.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from ai_core.mastery import (
    ADEQUATE_CEILING,
    DISPLAY_SE_CEILING,
    RETEST_DAYS,
    SE_PRIOR,
    WEAK_CEILING,
    MasteryState,
    evaluate,
    gap_severity,
    mastery_p,
    se_effective,
    state,
)
from ai_core.timeutil import utcnow

NOW = utcnow()


def _at(days_ago: float):
    return NOW - timedelta(days=days_ago)


# ── the five states ───────────────────────────────────────────────────────


def test_no_observations_is_not_tested_and_never_a_number():
    """AC-4.2: `not_tested` never returned as 0.0. A student who was never asked
    about graphs did not score zero on graphs."""
    view = evaluate(theta=0.0, se=SE_PRIOR, n_direct=0, last_evidence_at=None, now=NOW)

    assert view.state is MasteryState.not_tested
    assert view.mastery_p is None
    assert view.displayable is False
    assert view.label == "not tested yet"


def test_one_observation_is_emerging_not_weak():
    """EC-4.2. One answer is not a measurement, whatever it was."""
    view = evaluate(theta=-2.0, se=0.8, n_direct=1, last_evidence_at=_at(1), now=NOW)

    assert view.state is MasteryState.emerging
    assert view.mastery_p is None


def test_the_se_gate_binds_before_the_count_does():
    """EC-4.2 again: n >= 2 alone is not the rule. Two vague answers still leave
    us too uncertain to put a number on a screen."""
    view = evaluate(theta=0.5, se=1.2, n_direct=4, last_evidence_at=_at(0), now=NOW)

    assert view.se_effective >= DISPLAY_SE_CEILING
    assert view.state is MasteryState.emerging


@pytest.mark.parametrize(
    "theta,expected",
    [
        (-3.0, MasteryState.weak),
        (-0.5, MasteryState.weak),
        (0.0, MasteryState.adequate),
        (0.5, MasteryState.adequate),
        (1.5, MasteryState.strong),
        (3.0, MasteryState.strong),
    ],
)
def test_state_boundaries(theta, expected):
    assert state(theta=theta, se=0.3, n_direct=4, last_evidence_at=_at(1), now=NOW) is expected


def test_thresholds_are_on_mastery_p_not_theta():
    """The boundaries in §5.3 are stated in mastery_p. Reading them as theta
    would move `weak` from p<0.45 to p<0.39 and quietly relabel a band of
    students."""
    weak_edge = _theta_for(WEAK_CEILING)
    adequate_edge = _theta_for(ADEQUATE_CEILING)

    assert state(theta=weak_edge - 0.01, se=0.3, n_direct=4, last_evidence_at=_at(1), now=NOW) is (
        MasteryState.weak
    )
    assert state(theta=weak_edge + 0.01, se=0.3, n_direct=4, last_evidence_at=_at(1), now=NOW) is (
        MasteryState.adequate
    )
    assert state(
        theta=adequate_edge + 0.01, se=0.3, n_direct=4, last_evidence_at=_at(1), now=NOW
    ) is MasteryState.strong


def _theta_for(p: float) -> float:
    import math

    return math.log(p / (1 - p))


def test_gap_severity_is_one_minus_mastery_p():
    """M15 §6.9 ranks likely questions by this. `1 - theta` on a logit scale was
    never a severity — it is negative for anyone competent."""
    assert gap_severity(mastery_p(0.0)) == pytest.approx(0.5)
    assert 0.0 <= gap_severity(mastery_p(-3.0)) <= 1.0
    assert 0.0 <= gap_severity(mastery_p(3.0)) <= 1.0


# ── decay ─────────────────────────────────────────────────────────────────


def test_decay_never_lowers_theta():
    """§3.2.3. Decay widens the error bar; it never moves the estimate. A
    student must never appear to get worse by doing nothing."""
    fresh = evaluate(theta=1.2, se=0.3, n_direct=5, last_evidence_at=_at(0), now=NOW)
    stale = evaluate(theta=1.2, se=0.3, n_direct=5, last_evidence_at=_at(400), now=NOW)

    assert stale.se_effective > fresh.se_effective
    assert mastery_p(1.2) == pytest.approx(fresh.mastery_p)


def test_a_well_measured_concept_becomes_a_retest_candidate_within_120_days():
    """The test the previous multiplicative curve would have failed at any age.

    M05 stops a domain at se < 0.30, so every concept the CAT actually finished
    sits at se <= 0.30. Under `se * (1 + 0.35*(1-exp(-d/45)))` that caps at
    0.405 — below the 0.55 trigger forever — so the six-week "worth a refresh?"
    moment could never fire for exactly the concepts we measured best.
    """
    aged = evaluate(theta=1.0, se=0.30, n_direct=6, last_evidence_at=_at(RETEST_DAYS))
    assert aged.retest_candidate

    # The published curve, pinned: §6.5 states these three values for se = 0.30,
    # and they are what makes the threshold reachable at all.
    assert se_effective(0.30, _at(90), NOW) == pytest.approx(0.541, abs=0.001)
    assert se_effective(0.30, _at(183), NOW) == pytest.approx(0.708, abs=0.001)
    assert se_effective(0.30, _at(365), NOW) == pytest.approx(0.955, abs=0.001)

    # It crosses the 0.55 trigger at ~94 days — comfortably inside the 120-day
    # backstop, where the old multiplicative form capped at 0.405 forever.
    assert se_effective(0.30, _at(93), NOW) < 0.55 < se_effective(0.30, _at(96), NOW)


def test_se_effective_saturates_at_the_prior():
    """You cannot know less than you knew before you had any data."""
    assert se_effective(0.3, _at(10_000), NOW) == pytest.approx(SE_PRIOR)
    assert se_effective(SE_PRIOR, _at(10_000), NOW) <= SE_PRIOR


def test_long_absence_alone_triggers_a_retest():
    """EC-4.8: six months of inactivity is a reason to re-check even if the
    stored SE was tiny."""
    view = evaluate(theta=2.0, se=0.05, n_direct=20, last_evidence_at=_at(RETEST_DAYS + 1), now=NOW)
    assert view.retest_candidate is True


def test_untested_concepts_are_not_queued_for_retest():
    """A concept nobody was asked about is a question for the selector, not a
    row in the re-test queue."""
    view = evaluate(theta=0.0, se=SE_PRIOR, n_direct=0, last_evidence_at=None, now=NOW)
    assert view.retest_candidate is False


# ── hysteresis ────────────────────────────────────────────────────────────


def test_a_displayed_bar_greys_but_never_vanishes():
    """§6.5, EC-4.19. Decay past the display ceiling would otherwise remove the
    row, and an absent bar is a worse message than a shorter one."""
    aged = dict(theta=1.0, se=0.30, n_direct=6, last_evidence_at=_at(400), now=NOW)

    without_latch = evaluate(**aged, ever_displayed=False)
    with_latch = evaluate(**aged, ever_displayed=True)

    assert without_latch.se_effective >= DISPLAY_SE_CEILING
    assert without_latch.state is MasteryState.emerging
    assert with_latch.state is MasteryState.strong
    assert with_latch.stale is True
    assert with_latch.mastery_p is not None


def test_the_latch_does_not_cover_retracted_evidence():
    """FR-4.26 recomputes mastery from surviving observations. Evidence being
    withdrawn is not the passage of time, and continuing to show a number whose
    basis we just deleted is the dishonest half of the same rule."""
    view = evaluate(
        theta=1.0, se=0.3, n_direct=1, last_evidence_at=_at(1), ever_displayed=True, now=NOW
    )
    assert view.state is MasteryState.emerging


def test_a_fresh_value_is_not_stale():
    view = evaluate(
        theta=1.0, se=0.25, n_direct=6, last_evidence_at=_at(2), ever_displayed=True, now=NOW
    )
    assert view.stale is False
