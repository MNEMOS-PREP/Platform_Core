"""Who is asking, and what they may see.

Today every module takes `candidate_id` as a parameter supplied by the caller
and returns that student's data to whoever asked. Changing a UUID in a URL is
the whole attack. M01's contact route — name, email, phone — has its own audit
tag specifically so *"who saw this student's phone number"* is answerable, and
the answer is currently "anyone who guessed a UUID".

This is the contract half of fixing that, and it lives here rather than in a
module for the reason every other contract in this package does: nineteen
separate notions of "who is asking" will disagree, and a disagreement about
identity is a leak rather than a bug.

── What this file is, and what it deliberately is not ──────────────────────────

It is: the shape of a caller, the decision function, and a dependency a router
can take in one line.

It is **not** an authentication mechanism. How a student proves who they are —
college SSO, a session cookie, a signed token — is a product decision nobody has
made, and inventing one here would either be wrong for nineteen modules at once
or block all of them until it is right. `Resolver` is the seam: implement one,
register it, and every module that already takes `principal` starts enforcing
without another line changing.

── Fail closed, and say so ─────────────────────────────────────────────────────

No principal means no candidate-scoped data. Not "the default candidate", not an
empty list that looks like a normal empty state — a stated refusal. An empty
list is the failure mode that survives review, because it looks exactly like a
student who has not uploaded anything yet.

── The one thing to get right ──────────────────────────────────────────────────

`may_see` is a single call. A check that takes three lines and a comment is a
check somebody omits on the sixteenth endpoint, and the sixteenth endpoint is
the one that leaks.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

__all__ = [
    "AUTH_MODE",
    "Access",
    "Decision",
    "Principal",
    "Resolver",
    "Role",
    "may_see",
    "principal_from_headers",
    "set_resolver",
]


class Role(StrEnum):
    """What kind of caller this is.

    Four, and the list is closed on purpose: a role added in one module is a
    role the other eighteen do not know how to refuse.
    """

    #: The person the data is about. Sees their own, never anybody else's.
    student = "student"
    #: A placement cell officer. Aggregate by default — §15 decision 4's
    #: proposal, and the only safe stance while that decision is open.
    placement_officer = "placement_officer"
    #: Cohort statistics, never an individual. M19's research view.
    researcher = "researcher"
    #: Operations. Sees everything, and every access is worth logging.
    admin = "admin"


@dataclass(frozen=True)
class Principal:
    """The caller, resolved.

    Frozen because a principal that a request handler can edit is a principal
    a request handler can promote.
    """

    #: Stable id for this person in whatever identity system ends up in front.
    subject: str
    role: Role
    #: Which candidate this principal IS, when the principal is a student.
    #: `None` for staff — and a student with `None` here can see nothing, which
    #: is the correct reading of "we do not know whose account this is".
    candidate_id: str | None = None
    display_name: str | None = None

    def is_self(self, candidate_id: str) -> bool:
        return bool(self.candidate_id) and self.candidate_id == candidate_id


class Access(StrEnum):
    """How much of one student's data this caller may have.

    Deliberately the same three words M01's `retention.Disclosure` already uses.
    That module built the decision function for §15 decision 4 before there was
    anybody to ask it about, and its docstring says so: *"There is no auth in
    this platform yet, so this ANSWERS the question rather than enforcing it."*
    This is the caller it was waiting for; the vocabulary should not change on
    the way.
    """

    #: Everything about this student.
    full = "full"
    #: Counts and distributions, nobody named. The default for staff.
    aggregate_only = "aggregate_only"
    #: Nothing. No principal, or a student asking about somebody else.
    none = "none"


@dataclass(frozen=True)
class Decision:
    """The answer, and the reason — because the reason gets rendered.

    A refusal a student sees should say what would change it. A refusal a
    developer sees should say which check failed. One field, both readers.
    """

    access: Access
    reason: str

    def __bool__(self) -> bool:
        """True only for `full`. Aggregate is not permission to show a name."""
        return self.access is Access.full


def may_see(principal: Principal | None, candidate_id: str) -> Decision:
    """May this caller see this student's individual data?

    Never raises, always answers, and answers `none` when it does not know.

    A module holding an explicit share grant (M01's `ShareGrant`) can widen an
    `aggregate_only` for a placement officer — that is the module's business,
    because the grant lives there. Nothing may widen a `none`.
    """
    if principal is None:
        return Decision(Access.none, "Not signed in.")

    if principal.role is Role.admin:
        return Decision(Access.full, "Administrator.")

    if principal.role is Role.student:
        if principal.is_self(candidate_id):
            return Decision(Access.full, "Your own record.")
        return Decision(Access.none, "This is not your record.")

    if principal.role is Role.placement_officer:
        # §15 decision 4's proposal, and the safe stance while it is open. A
        # module with a share grant from this student may upgrade it.
        return Decision(
            Access.aggregate_only,
            "Placement staff see cohort figures. An individual view needs the student to share it.",
        )

    return Decision(Access.aggregate_only, "Research access is cohort-level only.")


# ---------------------------------------------------------------------------
#  Resolution — the seam an auth mechanism plugs into
# ---------------------------------------------------------------------------


class Resolver(Protocol):
    """Turns whatever a request carries into a `Principal`, or None.

    One method, because that is the whole surface an auth mechanism needs to
    present to nineteen modules. Returning None is normal — it means anonymous,
    and every caller already handles it.
    """

    def __call__(self, headers: dict[str, str]) -> Principal | None: ...


#: `dev` trusts a header and is for a machine with no login in front of it.
#: Anything else requires a registered resolver, and with none registered every
#: request is anonymous — which fails closed rather than falling back to `dev`.
AUTH_MODE = os.getenv("AI_AUTH_MODE", "dev")

_resolver: Resolver | None = None


def set_resolver(resolver: Resolver | None) -> None:
    """Register the platform's auth mechanism. Called once, at startup."""
    global _resolver
    _resolver = resolver


def _dev_principal(headers: dict[str, str]) -> Principal | None:
    """The development stand-in: a header names the caller.

    Every module already has this hole — `candidate_id` arrives from the caller
    and is trusted — so this changes nothing about how safe a dev machine is.
    What it changes is that the hole now has ONE name, is refused outside
    `AI_AUTH_MODE=dev`, and every call site is already written against the
    interface that will replace it.
    """
    lowered = {key.lower(): value for key, value in headers.items()}
    candidate = lowered.get("x-candidate-id")
    if not candidate:
        return None
    role = lowered.get("x-role", Role.student.value)
    try:
        parsed = Role(role)
    except ValueError:
        parsed = Role.student
    return Principal(
        subject=candidate,
        role=parsed,
        candidate_id=candidate if parsed is Role.student else lowered.get("x-candidate-scope"),
    )


def principal_from_headers(headers: dict[str, str]) -> Principal | None:
    """Resolve a caller. Returns None for anonymous, and never raises.

    A resolver that throws is a resolver that takes the platform down on a
    malformed token, so its failure is anonymity — which fails closed.
    """
    if _resolver is not None:
        try:
            return _resolver(headers)
        except Exception:  # noqa: BLE001 - a broken token is not a 500
            return None
    if AUTH_MODE == "dev":
        return _dev_principal(headers)
    return None
