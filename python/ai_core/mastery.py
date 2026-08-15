"""The five mastery states — one definition, published.

Specified in M04 §5.3, §6.5. M04 owns every *belief*; this module owns the
single rule that turns a belief into a state, a percentage and a word, because
five surfaces make that promise and a sixth interpretation of it is how the
promise quietly breaks:

    M04  the mastery map, the evidence drawer
    M05  question selection ("check the ones we are least sure about")
    M15  "Your preparation" — `gap_severity` is derived here, see below
    M16  the study plan's bottleneck
    M19  the student report

The promise, platform Rule 2: **"not tested" is not zero.** A student who has
never been asked about graphs has not scored 0 on graphs, and every API and UI
boundary has to keep those apart (FR-4.9, AC-4.2). That is why `mastery_p` is
`None` rather than `0.0` when there is nothing to say, and why the state enum
has a `not_tested` member instead of a nullable float.

Three constants are load-bearing and were each wrong in an earlier draft, so
they carry their arithmetic with them:

``SIGMA_DRIFT``  additive variance drift. The previous multiplicative form
                 capped at 1.35x, which meant a *well*-measured concept
                 (se <= 0.30, where M05 stops) could never become a re-test
                 candidate at any age, while a barely-measured one crossed in
                 a month. Exactly backwards, and it silently deleted the
                 six-week "worth a refresh?" moment.
``SE_PRIOR``     the ceiling on decayed uncertainty. You cannot know less than
                 you knew before you had any data.
``DISPLAY_SE``   the display gate, held open by hysteresis once a concept has
                 been shown: a bar that vanishes is a worse message than a bar
                 that greys.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from ai_core.timeutil import days_between, utcnow

#: Goes into every observation's VersionStamp. Bump it and a stored state may
#: mean something different from the one it meant last month, which is Trap 4
#: (comparing across rubric versions) wearing a different hat.
STATE_THRESHOLDS_VERSION = "1.0"

#: Prior SD of ability, in logits, before any evidence. Also the ceiling on
#: decay and on propagation-widened SE.
SE_PRIOR = 1.5

#: Logits of true-ability drift per 90 days of not being tested. Additive in
#: VARIANCE, saturating at the prior.
SIGMA_DRIFT = 0.45
DRIFT_WINDOW_DAYS = 90.0

#: theta is clamped on write. A runaway estimator produces absurd narratives
#: long before it produces a crash.
THETA_MIN = -4.0
THETA_MAX = 4.0

#: Above this effective SE we do not claim to know a value...
DISPLAY_SE_CEILING = 0.90
#: ...and above this one, we ask to check it again. Two thresholds because
#: they are doing different jobs: one guards a claim, the other schedules work.
RETEST_SE_THRESHOLD = 0.55
RETEST_DAYS = 120.0

#: Fewer direct observations than this and we say "just started", whatever the
#: SE happens to be. Two answers is not a measurement.
MIN_DIRECT_FOR_DISPLAY = 2

WEAK_CEILING = 0.45
ADEQUATE_CEILING = 0.70


class MasteryState(StrEnum):
    not_tested = "not_tested"
    emerging = "emerging"
    weak = "weak"
    adequate = "adequate"
    strong = "strong"


#: The student-facing string for each state. The enum name is NEVER rendered:
#: "weak" as a label reads as a verdict on the person, "needs work" reads as a
#: description of a topic, and they cost the same to ship.
STATE_LABEL: dict[MasteryState, str] = {
    MasteryState.not_tested: "not tested yet",
    MasteryState.emerging: "just started",
    MasteryState.weak: "needs work",
    MasteryState.adequate: "solid",
    MasteryState.strong: "strong",
}

#: How the bar is drawn. Three of these differ by TEXTURE as well as hue,
#: because the difference between "not tested", "just started" and "needs
#: work" has to survive greyscale and colour-blindness (M04 §2.3 rule 2).
STATE_TEXTURE: dict[MasteryState, str] = {
    MasteryState.not_tested: "dashed",  # outline only, no fill
    MasteryState.emerging: "hatched",  # 20% fill, hatched
    MasteryState.weak: "solid-amber",
    MasteryState.adequate: "solid-green",
    MasteryState.strong: "solid-green-full",
}

DISPLAYABLE_STATES = (MasteryState.weak, MasteryState.adequate, MasteryState.strong)


def mastery_p(theta: float) -> float:
    """The consumer scalar: 0–1, monotone in theta. `1 / (1 + exp(-theta))`.

    Students never see theta (open decision 2: logits are meaningless to a
    20-year-old and invite gaming). They see this, a five-state word, and a
    bar. M15's `gap_severity` is `1 - mastery_p`, which is correct by
    construction where `1 - theta` on a logit scale never was.
    """
    return 1.0 / (1.0 + math.exp(-_clamp_theta(theta)))


def gap_severity(p: float) -> float:
    """How far this concept is from mastered, 0–1. M15 §6.9 ranks on it."""
    return 1.0 - p


def _clamp_theta(theta: float) -> float:
    return max(THETA_MIN, min(THETA_MAX, theta))


def se_effective(
    se: float,
    last_evidence_at: datetime | None,
    now: datetime | None = None,
) -> float:
    """Stored uncertainty, widened for the time since we last checked.

    ``var_eff = min(se^2 + SIGMA_DRIFT^2 * days/90, SE_PRIOR^2)``

    **theta is unchanged, always.** Decay widens the error bar; it never lowers
    the estimate. If confidence decay lowered the displayed bar, students would
    think they got worse by doing nothing, which is both false and the kind of
    false that loses a user permanently (M04 §3.2.3).

    `se` is persisted; this is computed on read, from here, everywhere. A
    replay or a golden snapshot uses the stored `se` instead — the two are
    different questions and conflating them makes CI results depend on the
    date the suite ran.

    Worked, for `se = 0.30` (where M05 stops a domain): 0.541 at 90 days,
    0.708 at 183, 0.955 at 365. It crosses the re-test threshold at ~34 days
    and the display ceiling at ~1 year, which is the behaviour §6.5 describes.
    """
    if last_evidence_at is None:
        return SE_PRIOR
    days = max(0.0, days_between(now or utcnow(), last_evidence_at))
    var = se**2 + (SIGMA_DRIFT**2) * (days / DRIFT_WINDOW_DAYS)
    return math.sqrt(min(var, SE_PRIOR**2))


@dataclass(frozen=True)
class MasteryView:
    """Everything a surface needs to render one concept, and nothing else.

    Returned rather than a bare state so that no consumer has to re-derive
    `mastery_p` from theta, mis-handle the `None`, and reintroduce the zero
    this module exists to prevent.
    """

    state: MasteryState
    #: None iff the state is not displayable. NEVER 0.0 for "we don't know".
    mastery_p: float | None
    se_effective: float
    #: The value decayed past the display ceiling but the bar is held open by
    #: hysteresis. The UI greys it and says "not checked since March".
    stale: bool
    retest_candidate: bool
    days_since_evidence: float | None

    @property
    def displayable(self) -> bool:
        return self.state in DISPLAYABLE_STATES

    @property
    def label(self) -> str:
        return STATE_LABEL[self.state]

    @property
    def texture(self) -> str:
        return STATE_TEXTURE[self.state]


def evaluate(
    *,
    theta: float,
    se: float,
    n_direct: int,
    last_evidence_at: datetime | None,
    ever_displayed: bool = False,
    now: datetime | None = None,
) -> MasteryView:
    """Turn a posterior into what a student sees. The platform's only definition.

    Takes primitives rather than M04's `Mastery` row so that this package does
    not have to know about M04's tables — the rule has to be callable from a
    module that only holds a cached copy of someone else's numbers.

    ``ever_displayed`` is the hysteresis latch (§6.5). Once a concept has been
    shown to a student it is never *un*-shown by the passage of time: it greys,
    it says when it was last checked, and it is queued for a re-test. A
    vanishing bar breaks the same promise a falling one would, and it is the
    worse of the two because the student has nothing to ask about.

    The latch deliberately does not cover a drop in `n_direct`, which only
    happens when observations are RETRACTED (FR-4.26). Evidence being withdrawn
    is not the passage of time, and continuing to show a number whose basis we
    have just deleted would be the dishonest half of the same rule.
    """
    now = now or utcnow()
    days = None if last_evidence_at is None else max(0.0, days_between(now, last_evidence_at))
    se_eff = se_effective(se, last_evidence_at, now)
    p = mastery_p(theta)

    retest = se_eff >= RETEST_SE_THRESHOLD or (days is not None and days >= RETEST_DAYS)

    if n_direct <= 0:
        return MasteryView(
            state=MasteryState.not_tested,
            mastery_p=None,
            se_effective=se_eff,
            stale=False,
            # Nothing to re-test. A concept nobody has been asked about is a
            # question for the selector, not a row in the re-test queue.
            retest_candidate=False,
            days_since_evidence=days,
        )

    too_uncertain = se_eff >= DISPLAY_SE_CEILING
    if n_direct < MIN_DIRECT_FOR_DISPLAY or (too_uncertain and not ever_displayed):
        return MasteryView(
            state=MasteryState.emerging,
            mastery_p=None,
            se_effective=se_eff,
            stale=False,
            retest_candidate=retest,
            days_since_evidence=days,
        )

    if p < WEAK_CEILING:
        state = MasteryState.weak
    elif p < ADEQUATE_CEILING:
        state = MasteryState.adequate
    else:
        state = MasteryState.strong

    return MasteryView(
        state=state,
        mastery_p=p,
        se_effective=se_eff,
        stale=too_uncertain,
        retest_candidate=retest,
        days_since_evidence=days,
    )


def state(
    *,
    theta: float,
    se: float,
    n_direct: int,
    last_evidence_at: datetime | None,
    ever_displayed: bool = False,
    now: datetime | None = None,
) -> MasteryState:
    """The five-state rule on its own, for callers that need only the word."""
    return evaluate(
        theta=theta,
        se=se,
        n_direct=n_direct,
        last_evidence_at=last_evidence_at,
        ever_displayed=ever_displayed,
        now=now,
    ).state
