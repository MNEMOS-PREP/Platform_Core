"""Who may see whose data.

Every test here is about a refusal, because the refusals are what this file
buys. The permissions were never the hard part — nineteen modules already
return everything to everybody, so "a student can see their own resume" has
been true and useless the whole time.
"""

from __future__ import annotations

import pytest

from ai_core import identity
from ai_core.identity import Access, Principal, Role, may_see


@pytest.fixture(autouse=True)
def _clean_resolver():
    identity.set_resolver(None)
    yield
    identity.set_resolver(None)


STUDENT = "4d0aa1c0-0000-4000-8000-000000000004"
SOMEBODY_ELSE = "9f1bb2d1-0000-4000-8000-000000000009"


def _student(candidate_id: str = STUDENT) -> Principal:
    return Principal(subject=candidate_id, role=Role.student, candidate_id=candidate_id)


# ---------------------------------------------------------------------------
#  Fail closed
# ---------------------------------------------------------------------------


def test_nobody_is_not_somebody():
    """The whole hole, in one assertion.

    Today this returns the student's resume, their claims and their phone
    number to a caller who guessed a UUID.
    """
    decision = may_see(None, STUDENT)

    assert decision.access is Access.none
    assert not decision


def test_a_refusal_carries_a_reason_a_person_can_read():
    """The reason gets rendered. A student who cannot see something should be
    told what would change that, not shown an empty page."""
    assert may_see(None, STUDENT).reason
    assert may_see(_student(), SOMEBODY_ELSE).reason


def test_aggregate_is_not_permission():
    """`bool(decision)` is true only for `full`.

    The dangerous reading is `if may_see(...)` passing for a placement officer
    and a screen then rendering a name. Aggregate access is a different
    question with a different answer, and it must not be truthy.
    """
    officer = Principal(subject="cell-1", role=Role.placement_officer)
    decision = may_see(officer, STUDENT)

    assert decision.access is Access.aggregate_only
    assert not decision


# ---------------------------------------------------------------------------
#  Students
# ---------------------------------------------------------------------------


def test_a_student_sees_their_own_record():
    assert may_see(_student(), STUDENT).access is Access.full


def test_a_student_cannot_see_another_student():
    """The attack that works today: change the UUID in the URL."""
    decision = may_see(_student(), SOMEBODY_ELSE)

    assert decision.access is Access.none
    assert "not your record" in decision.reason


def test_a_student_with_no_candidate_id_sees_nothing():
    """"We do not know whose account this is" is not a reason to show them one.

    A `Principal` can arrive with `candidate_id=None` from a resolver that
    authenticated somebody but could not map them to a student, and defaulting
    that to "the current candidate" is how the hole reopens.
    """
    orphan = Principal(subject="who", role=Role.student, candidate_id=None)

    assert may_see(orphan, STUDENT).access is Access.none


# ---------------------------------------------------------------------------
#  Staff
# ---------------------------------------------------------------------------


def test_a_placement_officer_gets_aggregate_by_default():
    """§15 decision 4's proposal, and the only safe stance while it is open.

    A module holding an explicit `ShareGrant` from the student may widen this;
    nothing may widen a `none`.
    """
    officer = Principal(subject="cell-1", role=Role.placement_officer)

    assert may_see(officer, STUDENT).access is Access.aggregate_only


def test_a_researcher_never_gets_an_individual():
    researcher = Principal(subject="r-1", role=Role.researcher)

    assert may_see(researcher, STUDENT).access is Access.aggregate_only


def test_an_admin_sees_everything():
    admin = Principal(subject="ops-1", role=Role.admin)

    assert may_see(admin, STUDENT).access is Access.full


# ---------------------------------------------------------------------------
#  Resolution
# ---------------------------------------------------------------------------


def test_no_headers_is_anonymous():
    assert identity.principal_from_headers({}) is None


def test_the_dev_resolver_reads_a_header(monkeypatch):
    monkeypatch.setattr(identity, "AUTH_MODE", "dev")

    principal = identity.principal_from_headers({"X-Candidate-Id": STUDENT})

    assert principal is not None
    assert principal.role is Role.student
    assert principal.is_self(STUDENT)


def test_outside_dev_mode_a_header_proves_nothing(monkeypatch):
    """The dev stand-in must not be the production fallback.

    A header anybody can set is exactly the hole this file exists to close, so
    it is refused the moment the platform claims to have real auth — and with
    no resolver registered the answer is anonymous, not "trust the header".
    """
    monkeypatch.setattr(identity, "AUTH_MODE", "production")

    assert identity.principal_from_headers({"X-Candidate-Id": STUDENT}) is None


def test_a_registered_resolver_wins():
    identity.set_resolver(lambda headers: Principal(subject="s", role=Role.admin))

    principal = identity.principal_from_headers({})

    assert principal is not None and principal.role is Role.admin


def test_a_resolver_that_throws_yields_anonymous_rather_than_a_500():
    """A malformed token is a bad request, not an outage — and the safe
    reading of "this token is broken" is "we do not know who you are"."""

    def explode(headers):
        raise ValueError("malformed token")

    identity.set_resolver(explode)

    assert identity.principal_from_headers({"authorization": "Bearer nonsense"}) is None


def test_an_unknown_role_does_not_become_a_powerful_one(monkeypatch):
    """A typo in a header must fall back DOWN, never up."""
    monkeypatch.setattr(identity, "AUTH_MODE", "dev")

    principal = identity.principal_from_headers(
        {"X-Candidate-Id": STUDENT, "X-Role": "superuser"}
    )

    assert principal is not None
    assert principal.role is Role.student
