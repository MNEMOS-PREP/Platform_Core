"""`VersionStamp` — which versions produced a number.

Specified in M19 §5 (the Evidence Ledger owns it), stored by M04 on every
observation, produced by M13 on every evaluation, and read by M16 to decide
whether two scores are comparable at all.

It lives here for the reason `EvidenceRef` does, and it arrived here the way
these things usually do: **two modules had already written their own copy, and
the copies had already diverged.** M04 declared it with `str` fields and
invented defaults (`"1.0"`, `"none"`, `"dev"`) and no `extractor_versions`;
M13 declared it with `str | None` and `extractor_versions`, matching M19.
Posting M13's shape to M04 was a 422 nobody had hit yet only because the emit
had not been wired.

**Why every field is nullable.** A stamp is a record of what was *known* at
write time. A module that has no calibration yet genuinely has no
`calibration_version`, and the honest representation of that is `None` — not
`"1.0"`, which is a version number nobody chose and which makes an
uncalibrated score look comparable to a calibrated one. `code_sha` is the
exception: something always produced the row, so it defaults to a marker
rather than to null.

**Why `code_sha` matters more than it looks.** Trap 7 in M13 and Trap 4 in M04
are both "comparing scores across versions", and the usual telling is about
rubrics. But a prompt tweak, an estimator fix or a scoring bug are equally
capable of moving a number, and none of them bumps a rubric version. Without
`code_sha` a re-score cannot be attributed to a code change — which is the one
attribution a regression suite exists to make.
"""

from __future__ import annotations

from pydantic import BaseModel

#: What `code_sha` says when nobody wired it up yet. Deliberately not a
#: plausible-looking sha: a stamp that cannot be traced should look untraceable
#: rather than look like a commit somebody could go and read.
UNKNOWN_SHA = "unknown"


class VersionStamp(BaseModel):
    """The versions behind one stored number. M19 §5.

    Stamping a subset is how "you improved 30%" quietly becomes false, so the
    rule is: stamp everything that could have moved the number, and use `None`
    for what genuinely did not exist rather than a placeholder that reads as a
    real version.
    """

    #: The rubric a score was produced under (M13).
    rubric_version: str | None = None
    #: The evaluator prompt (M13).
    prompt_version: str | None = None
    #: The MODEL or ensemble config that produced it. An ensemble legitimately
    #: spans several model ids, so this names the configuration and the
    #: individual models live on the per-evaluator record.
    model_id: str | None = None
    #: The fitted calibration applied. None means none was — which is exactly
    #: what the display gate keys off (M13 §6.7).
    calibration_version: str | None = None
    #: The item bank the question came from (M05).
    item_bank_version: str | None = None
    #: Feature extractors, per channel (M12).
    extractor_versions: dict[str, str] | None = None
    #: The code that ran. Always present.
    code_sha: str = UNKNOWN_SHA

    def comparable_to(self, other: VersionStamp) -> bool:
        """Whether two numbers may be put on the same axis.

        Deliberately strict, and deliberately not a similarity score: a
        longitudinal claim is either defensible or it is not. Fields that are
        `None` on both sides agree — two uncalibrated scores are comparable to
        each other, they just cannot be compared to a calibrated one.

        `code_sha` is NOT part of this. Every deploy would otherwise sever
        every trajectory, which would make the check useless and get it
        switched off. It is recorded for attribution, not for comparability.
        """
        return (
            self.rubric_version == other.rubric_version
            and self.calibration_version == other.calibration_version
            and self.item_bank_version == other.item_bank_version
        )


__all__ = ["UNKNOWN_SHA", "VersionStamp"]
