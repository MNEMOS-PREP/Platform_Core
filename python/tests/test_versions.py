"""`VersionStamp` — the type two modules had already written twice."""

from __future__ import annotations

from ai_core.versions import UNKNOWN_SHA, VersionStamp


def test_everything_defaults_to_unknown_rather_than_to_a_plausible_version():
    """A stamp records what was KNOWN, and "not calibrated" is not "v1.0".

    M04's local copy defaulted these to "1.0" / "none" / "dev", which made an
    uncalibrated score look comparable to a calibrated one. None is the honest
    representation and it is what makes `comparable_to` mean anything.
    """
    stamp = VersionStamp()
    assert stamp.rubric_version is None
    assert stamp.calibration_version is None
    assert stamp.item_bank_version is None
    assert stamp.extractor_versions is None
    assert stamp.code_sha == UNKNOWN_SHA


def test_carries_extractor_versions():
    """M12's channels version independently; M04's copy could not hold them."""
    stamp = VersionStamp(extractor_versions={"prosody": "2.1", "visual": "0.9"})
    assert stamp.extractor_versions == {"prosody": "2.1", "visual": "0.9"}


def test_same_versions_are_comparable():
    a = VersionStamp(rubric_version="1.0.0", calibration_version="c1", item_bank_version="b1")
    b = VersionStamp(rubric_version="1.0.0", calibration_version="c1", item_bank_version="b1")
    assert a.comparable_to(b)


def test_a_rubric_bump_severs_comparability():
    """Trap 7 / Trap 4 — "you improved 30%" across a rubric change is fiction."""
    a = VersionStamp(rubric_version="1.0.0")
    b = VersionStamp(rubric_version="2.0.0")
    assert not a.comparable_to(b)


def test_calibrated_and_uncalibrated_are_not_comparable():
    uncalibrated = VersionStamp(rubric_version="1.0.0")
    calibrated = VersionStamp(rubric_version="1.0.0", calibration_version="c1")
    assert not uncalibrated.comparable_to(calibrated)
    # ...but two uncalibrated scores sit on the same axis as each other.
    assert uncalibrated.comparable_to(VersionStamp(rubric_version="1.0.0"))


def test_code_sha_does_not_sever_comparability():
    """Every deploy would otherwise break every trajectory, and the check
    would be switched off within a week. It is for attribution, not axes."""
    a = VersionStamp(rubric_version="1.0.0", code_sha="aaaa")
    b = VersionStamp(rubric_version="1.0.0", code_sha="bbbb")
    assert a.comparable_to(b)


def test_prompt_and_model_do_not_sever_comparability_either():
    """Same reasoning: these move a number, so they are recorded — but a
    prompt tweak is not a scale change, and treating it as one makes the
    longitudinal view useless."""
    a = VersionStamp(rubric_version="1.0.0", prompt_version="p1", model_id="n3_het_v1")
    b = VersionStamp(rubric_version="1.0.0", prompt_version="p2", model_id="n1_practice")
    assert a.comparable_to(b)
