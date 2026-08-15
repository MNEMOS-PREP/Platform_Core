"""`EvidenceRef` — the atomic unit of justification for the whole platform.

Platform Rule 3: *every number traces to something the student said or did.*
This module is that rule expressed as a type. M13 produces evidence refs, M04
stores them against every observation, M19's ledger is a projection over them,
and M16 renders them. It lives here rather than in any one module for the
reason `dependencies.txt` already gives for the provenance components:
nineteen copies would drift, and "every number traces to evidence" would
quietly stop being true in whichever repo fell behind — while that repo's own
tests kept passing.

Specified in M04 §5.1.

**Resolution is the part that matters.** A reference that cannot be checked is
decoration. So a ref carries the checksum of the artifact as it was at write
time, and resolving it means all three of:

1. the artifact still exists,
2. ``sha256(artifact) == ref.checksum`` — it has not changed underneath us,
3. if a span is present, the quoted text is really at those offsets.

There are three outcomes, not two, and the difference between the last two is
a product decision rather than a technicality:

``resolved``       the evidence is there and says what we claimed it said.
``tombstoned``     the artifact was deleted on purpose — retention expiry, a
                   deletion request. The observation stays, the number stays,
                   and the evidence drawer says "evidence expired" (M04
                   EC-4.9). Deleting a recording must not silently rewrite a
                   student's history.
``unresolvable``   the artifact never existed, or its content no longer
                   matches the checksum. This is a bug or a corruption, and
                   M04 §6.2 raises on it at write time rather than storing a
                   claim it cannot back.

The distinction requires the store to tell "deleted" from "never there", which
is why :class:`ArtifactStore` has a three-valued ``status`` rather than an
``Optional`` load.
"""

from __future__ import annotations

import hashlib
import re
from enum import StrEnum
from typing import Literal, Protocol, runtime_checkable
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

_WHITESPACE = re.compile(r"\s+")


def normalise_quote(text: str) -> str:
    """Collapse whitespace for quote comparison. The only normalisation allowed.

    A transcript re-wrapped by a different renderer, or a code artifact whose
    trailing newline was stripped in transit, must not tombstone a perfectly
    good citation. Anything beyond whitespace — case, punctuation, accents —
    is NOT normalised, because "verbatim" has to keep meaning verbatim or the
    quote screens that depend on it (M15 §6.8, M04 §6.6b) stop screening.
    """
    return _WHITESPACE.sub(" ", text).strip()


def sha256_hex(data: str | bytes) -> str:
    """The checksum written into an `EvidenceRef`. Lowercase hex, no prefix."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


class ArtifactState(StrEnum):
    """What a store knows about an artifact id."""

    present = "present"
    #: Deliberately deleted — retention, or a student's deletion request. The
    #: store keeps a tombstone row so this stays distinguishable from `absent`
    #: forever; without it, EC-4.9 and a corrupt reference look identical.
    tombstoned = "tombstoned"
    absent = "absent"


class EvidenceState(StrEnum):
    resolved = "resolved"
    tombstoned = "tombstoned"
    unresolvable = "unresolvable"


class EvidenceSpan(BaseModel):
    """The exact stretch of an artifact that justifies a claim."""

    artifact_type: Literal["transcript", "code", "canvas", "audio", "notes", "submission"]
    artifact_id: UUID
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    #: Verbatim. Checked against the artifact on resolution, never trusted.
    quote: str
    #: Offset into the recording, for artifacts that have a time axis.
    t_ms: int | None = None
    #: Set by the resolver, not by the producer. A producer asserting its own
    #: evidence is verified is the failure mode this whole module exists to
    #: prevent.
    verified: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> EvidenceSpan:
        if self.end < self.start:
            raise ValueError(f"span end {self.end} precedes start {self.start}")
        return self


class EvidenceRef(BaseModel):
    """Why a number is what it is.

    Resolvable two ways, so it works in Phase 1 before the Evidence Ledger
    (M19) exists: `ledger_entry_id` is None until M19 backfills it, and until
    then the resolver reads M04's own episodic tier — which M04 §6.6 already
    calls "the substrate everything else can be rebuilt from". That makes the
    ledger a projection over the episodic tier rather than a prerequisite for
    it, and it is why M04 can be built and demoed before M19 exists.
    """

    kind: Literal["span", "artifact", "ledger"]
    session_id: UUID
    turn_id: UUID | None = None
    #: REQUIRED when kind == "span".
    span: EvidenceSpan | None = None
    artifact_id: UUID | None = None
    #: None in Phase 1; backfilled by M19.
    ledger_entry_id: UUID | None = None
    #: sha256 of the artifact at write time.
    checksum: str

    @model_validator(mode="after")
    def _shape_matches_kind(self) -> EvidenceRef:
        if self.kind == "span" and self.span is None:
            raise ValueError("kind='span' requires a span")
        if self.kind == "artifact" and self.artifact_id is None and self.span is None:
            raise ValueError("kind='artifact' requires an artifact_id")
        if not self.checksum:
            raise ValueError("a ref without a checksum cannot be resolved, so it is not evidence")
        return self

    @property
    def target_artifact_id(self) -> UUID | None:
        """The artifact this ref points at, wherever it was recorded."""
        if self.span is not None:
            return self.span.artifact_id
        return self.artifact_id


class EvidenceResolution(BaseModel):
    """The result of checking a ref. Rendered by the evidence drawer."""

    state: EvidenceState
    #: A sentence for a developer log.
    detail: str
    #: The sentence a STUDENT sees in the drawer when this ref cannot be shown.
    #: None when the evidence resolved and the real quote is displayed instead.
    display_note: str | None = None

    @property
    def ok(self) -> bool:
        return self.state is EvidenceState.resolved

    @property
    def storable(self) -> bool:
        """Whether an observation carrying this ref may be written.

        Tombstoned counts: the evidence expired *after* the observation was
        made, and refusing the write would delete a student's history because
        of a retention job.
        """
        return self.state is not EvidenceState.unresolvable


@runtime_checkable
class ArtifactStore(Protocol):
    """What the resolver needs from whoever holds the artifacts.

    In Phase 1 M04's episodic tier implements this. In Phase 2 M19's ledger
    does, with identical semantics — which is the point of stating it as a
    protocol rather than importing a module.
    """

    def status(self, artifact_id: UUID) -> ArtifactState: ...

    def load(self, artifact_id: UUID) -> str | bytes | None:
        """The artifact's content, or None if it is not `present`."""
        ...


def resolve(ref: EvidenceRef, store: ArtifactStore) -> EvidenceResolution:
    """Check a reference against the artifact it claims to cite.

    This function is what M04's AC-4.1 gate tests, so it is deliberately
    unforgiving: every failure mode returns a distinct `detail`, and none of
    them return `resolved`.
    """
    artifact_id = ref.target_artifact_id
    if artifact_id is None:
        return EvidenceResolution(
            state=EvidenceState.unresolvable,
            detail="reference names no artifact",
        )

    state = store.status(artifact_id)
    if state is ArtifactState.tombstoned:
        return EvidenceResolution(
            state=EvidenceState.tombstoned,
            detail=f"artifact {artifact_id} was deleted (retention or request)",
            display_note="evidence expired",
        )
    if state is ArtifactState.absent:
        return EvidenceResolution(
            state=EvidenceState.unresolvable,
            detail=f"artifact {artifact_id} does not exist",
        )

    content = store.load(artifact_id)
    if content is None:
        return EvidenceResolution(
            state=EvidenceState.unresolvable,
            detail=f"artifact {artifact_id} reported present but loaded empty",
        )

    if sha256_hex(content) != ref.checksum:
        # NOT tombstoned. A changed artifact means the quote we stored may no
        # longer be what the student said, and a citation we cannot trust is
        # worse than no citation: it is a false one, rendered confidently.
        return EvidenceResolution(
            state=EvidenceState.unresolvable,
            detail=f"artifact {artifact_id} no longer matches the checksum recorded at write time",
        )

    if ref.span is not None:
        text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else content
        excerpt = text[ref.span.start : ref.span.end]
        if normalise_quote(excerpt) != normalise_quote(ref.span.quote):
            return EvidenceResolution(
                state=EvidenceState.unresolvable,
                detail=(
                    f"span [{ref.span.start}:{ref.span.end}] of artifact {artifact_id} "
                    f"does not contain the quoted text"
                ),
            )

    return EvidenceResolution(state=EvidenceState.resolved, detail="resolved")


class UnresolvableEvidence(ValueError):
    """Raised on a write whose evidence cannot be resolved (M04 §6.2, FR-4.5).

    Deliberately a hard failure with no silent-drop path: an observation that
    quietly loses its evidence becomes a mastery change nobody can explain,
    and Rule 3 dies one dropped reference at a time.
    """

    def __init__(self, ref: EvidenceRef, resolution: EvidenceResolution) -> None:
        super().__init__(resolution.detail)
        self.ref = ref
        self.resolution = resolution
