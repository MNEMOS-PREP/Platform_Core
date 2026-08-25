"""One number, declared in four places, checked in one.

`src/index.ts` has carried this instruction since 0.5.1:

    Must equal `package.json` version and `ai_core.__version__`. It was left at
    0.3.0 across two releases, which is the exact failure this package exists
    to prevent, in its own source: a version string that reports a state of the
    world it is not in. Move all three in the same commit.

It then happened again, the same way and for the same distance: the TypeScript
half moved to 0.7.0 and 0.7.1 while the Python half stayed at 0.6.0 across both.
An instruction in a comment is a reminder, and a reminder that has now failed
twice is not a mechanism.

── Why this matters more here than in most packages ────────────────────────────

Nineteen repositories pin this package by tag and read its version to decide
what they may call. A backend that imports `ai_core` and asks it what version
it is gets an answer that decides whether a contract exists — so a Python half
reporting 0.6.0 from a 0.7.1 tag is not cosmetic, it is the package's own
warranty being wrong about itself. This is the package whose entire argument is
that a shared fact drifts the moment each consumer keeps its own copy.

── Why every one of these is read as a FILE ────────────────────────────────────

Including `__version__`, which could just be imported. It must not be: this
package is installed into each module's virtualenv as a COPY rather than as an
editable link, so `import ai_core` inside a checkout of this repository can
resolve to a vendored snapshot from a different release. Written the obvious
way, this test compared three files in the working tree against a version
string from somebody else's site-packages — and reported a mismatch that was
real but was not the one it meant to catch.

Four files in this repository, read from this repository. Nothing else.

── What is deliberately not checked ────────────────────────────────────────────

The git tag. It is not readable from a source tree fetched as an archive, which
is how npm installs this, and a check that cannot run where it matters is worse
than none. The four files below are the ones a release has to move together.
"""

from __future__ import annotations

import json
import pathlib
import re
import tomllib

#: `python/tests/` -> `python/` -> the repository root.
_ROOT = pathlib.Path(__file__).resolve().parents[2]


def _package_json() -> str:
    return json.loads((_ROOT / "package.json").read_text(encoding="utf-8"))["version"]


def _index_ts() -> str:
    source = (_ROOT / "src" / "index.ts").read_text(encoding="utf-8")
    match = re.search(r'export const CORE_VERSION = "([^"]+)"', source)
    assert match, "CORE_VERSION is not declared in src/index.ts the way this test reads it"
    return match.group(1)


def _pyproject() -> str:
    with (_ROOT / "python" / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)["project"]["version"]


def _dunder_version() -> str:
    source = (_ROOT / "python" / "ai_core" / "__init__.py").read_text(encoding="utf-8")
    match = re.search(r'^__version__ = "([^"]+)"', source, re.MULTILINE)
    assert match, "__version__ is not declared in ai_core/__init__.py the way this test reads it"
    return match.group(1)


def _declared() -> dict[str, str]:
    return {
        "package.json": _package_json(),
        "src/index.ts CORE_VERSION": _index_ts(),
        "python/pyproject.toml": _pyproject(),
        "ai_core.__version__": _dunder_version(),
    }


def test_all_four_declarations_agree():
    """The whole point. A release moves every one of these or none of them."""
    declared = _declared()

    assert len(set(declared.values())) == 1, "these disagree about which version this is:\n  " + (
        "\n  ".join(f"{where:26} {value}" for where, value in declared.items())
    )


def test_the_version_is_a_version():
    """A guard against the fix for the above being to blank one of them out.

    Making four empty strings agree is not what this package promises.
    """
    for where, value in _declared().items():
        assert re.fullmatch(r"\d+\.\d+\.\d+", value), (
            f"{where} declares {value!r}, which is not a three-part version"
        )
