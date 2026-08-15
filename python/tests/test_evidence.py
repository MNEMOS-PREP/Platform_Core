"""Evidence references and their resolution (M04 §5.1, AC-4.1)."""

from __future__ import annotations

import uuid

import pytest

from ai_core.evidence import (
    ArtifactState,
    EvidenceRef,
    EvidenceSpan,
    EvidenceState,
    normalise_quote,
    resolve,
    sha256_hex,
)

TRANSCRIPT = "I would add an index on the user_id column so the join stops scanning."


class FakeStore:
    """The minimum an artifact store has to provide. M04's episodic tier is the
    real one in Phase 1; M19's ledger is the same protocol in Phase 2."""

    def __init__(self, artifacts: dict[uuid.UUID, str], tombstones: set[uuid.UUID] | None = None):
        self.artifacts = artifacts
        self.tombstones = tombstones or set()

    def status(self, artifact_id: uuid.UUID) -> ArtifactState:
        if artifact_id in self.artifacts:
            return ArtifactState.present
        if artifact_id in self.tombstones:
            return ArtifactState.tombstoned
        return ArtifactState.absent

    def load(self, artifact_id: uuid.UUID) -> str | None:
        return self.artifacts.get(artifact_id)


def _ref(artifact_id: uuid.UUID, text: str, quote: str, start: int, checksum: str | None = None):
    return EvidenceRef(
        kind="span",
        session_id=uuid.uuid4(),
        turn_id=uuid.uuid4(),
        span=EvidenceSpan(
            artifact_type="transcript",
            artifact_id=artifact_id,
            start=start,
            end=start + len(quote),
            quote=quote,
        ),
        checksum=checksum or sha256_hex(text),
    )


def test_a_good_reference_resolves():
    aid = uuid.uuid4()
    store = FakeStore({aid: TRANSCRIPT})
    ref = _ref(aid, TRANSCRIPT, "add an index", TRANSCRIPT.index("add an index"))

    assert resolve(ref, store).state is EvidenceState.resolved


def test_deleted_artifact_tombstones_rather_than_failing():
    """EC-4.9. Retention deleting a recording must not erase a student's history:
    the observation stays, the number stays, and the drawer says why."""
    aid = uuid.uuid4()
    store = FakeStore({}, tombstones={aid})
    ref = _ref(aid, TRANSCRIPT, "add an index", 10)

    result = resolve(ref, store)
    assert result.state is EvidenceState.tombstoned
    assert result.storable is True
    assert result.display_note == "evidence expired"


def test_artifact_that_never_existed_is_unresolvable():
    ref = _ref(uuid.uuid4(), TRANSCRIPT, "add an index", 10)

    result = resolve(ref, FakeStore({}))
    assert result.state is EvidenceState.unresolvable
    assert result.storable is False


def test_changed_artifact_is_unresolvable_not_tombstoned():
    """A quote we can no longer verify is worse than no quote: it is a false
    citation rendered confidently."""
    aid = uuid.uuid4()
    ref = _ref(aid, TRANSCRIPT, "add an index", TRANSCRIPT.index("add an index"))
    store = FakeStore({aid: TRANSCRIPT + " Actually, no."})

    result = resolve(ref, store)
    assert result.state is EvidenceState.unresolvable
    assert "checksum" in result.detail


def test_span_pointing_at_the_wrong_offsets_is_caught():
    aid = uuid.uuid4()
    store = FakeStore({aid: TRANSCRIPT})
    ref = _ref(aid, TRANSCRIPT, "add an index", 0)  # the quote is not at offset 0

    assert resolve(ref, store).state is EvidenceState.unresolvable


def test_whitespace_is_the_only_normalisation():
    aid = uuid.uuid4()
    text = "I would   add an\nindex on the column."
    store = FakeStore({aid: text})
    ref = EvidenceRef(
        kind="span",
        session_id=uuid.uuid4(),
        span=EvidenceSpan(
            artifact_type="transcript",
            artifact_id=aid,
            start=8,
            end=text.index("index") + 5,
            quote="add an index",
        ),
        checksum=sha256_hex(text),
    )
    assert resolve(ref, store).state is EvidenceState.resolved

    # ...but case is not whitespace.
    assert normalise_quote("Add An  Index") != normalise_quote("add an index")


def test_a_span_ref_without_a_span_is_rejected_at_construction():
    with pytest.raises(ValueError):
        EvidenceRef(kind="span", session_id=uuid.uuid4(), checksum="abc")


def test_a_ref_without_a_checksum_is_rejected():
    """FR-4.5 lives in the type, not in a NOT NULL constraint."""
    with pytest.raises(ValueError):
        EvidenceRef(kind="artifact", session_id=uuid.uuid4(), artifact_id=uuid.uuid4(), checksum="")


def test_a_backwards_span_is_rejected():
    with pytest.raises(ValueError):
        EvidenceSpan(artifact_type="code", artifact_id=uuid.uuid4(), start=90, end=10, quote="x")
