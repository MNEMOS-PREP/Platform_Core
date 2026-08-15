"""The concept graph's shape — what there is to know, and what depends on what.

Specified in M04 §5.2. M04 owns the *content* of the ontology (the YAML, the
loader, the linter, the faculty review) and it owns every belief about a
student. What lives here is only the shape, because four other modules speak
it and none of them may invent their own:

    M01  maps resume surface forms to concept ids
    M02  maps JD requirements to concept ids
    M05  keys its question bank on concept ids
    M15  keys a company corpus on the free-text topic labels students typed

All four call `POST /v1/concepts/resolve` on M04 and none of them can define
what comes back. `normalise_alias` in particular has to be identical on both
sides of that call, or a label that resolves in the resolver's tests fails at
the caller's — which is a class of bug nobody finds by reading either repo.
"""

from __future__ import annotations

import re
import unicodedata
from enum import StrEnum

from pydantic import BaseModel, Field


class ConceptDomain(StrEnum):
    dsa = "dsa"
    cs_core = "cs_core"
    ml = "ml"
    system_design = "system_design"
    tooling = "tooling"
    aptitude = "aptitude"
    communication = "communication"
    behavioural = "behavioural"


class ConceptLevel(StrEnum):
    foundational = "foundational"
    intermediate = "intermediate"
    advanced = "advanced"


class EdgeKind(StrEnum):
    #: The only kind that must stay acyclic, and the only one the bottleneck
    #: walk (M04 §6.8) and propagation (§6.4) traverse.
    prerequisite_of = "prerequisite_of"
    specialises = "specialises"
    applies_to = "applies_to"
    co_occurs_with = "co_occurs_with"


_PUNCTUATION = re.compile(r"[^\w\s]", flags=re.UNICODE)
_WHITESPACE = re.compile(r"\s+")


def normalise_alias(label: str) -> str:
    """The key an alias is stored and looked up under.

    Casefold, strip accents, drop punctuation, collapse whitespace — in that
    order, so `"Dynamic-Programming"`, `"dynamic programming"` and
    `"DYNAMIC  PROGRAMMING"` are one key and a student typing any of them into
    a post-drive submission gets the same concept.

    Deliberately NOT stemming or fuzzy matching: `"tree"` and `"trie"` are one
    edit apart and are different concepts, and a resolver that guesses is worse
    than one that returns `unresolved` — EC-4.18 exists precisely so a caller
    can say "we could not match this" instead of claiming a mastery of zero.
    """
    decomposed = unicodedata.normalize("NFKD", label)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    cleaned = _PUNCTUATION.sub(" ", stripped.casefold())
    return _WHITESPACE.sub(" ", cleaned).strip()


class Concept(BaseModel):
    """One thing a student can know. Sized so a 60-minute session can test 4–8.

    M04 §3.2.1: granularity is a product decision, not a taxonomy decision.
    Too coarse ("DSA") and the feedback is useless; too fine ("Kadane's
    algorithm") and no node ever accumulates enough observations to estimate
    anything from.
    """

    #: Stable and human-readable: "concept:dynamic_programming". A UUID here
    #: would make every YAML diff and every log line unreadable for no gain —
    #: the ontology is hand-curated and small.
    id: str
    name: str
    domain: ConceptDomain
    level: ConceptLevel
    #: FR-4.21 — the resolver's source of truth. Misspellings belong here.
    aliases: list[str] = Field(default_factory=list)
    #: True ⇒ never surfaced as a bottleneck. "Work on variables" is insulting
    #: advice (M16 §6.4a), and the floor belongs in the shared query rather
    #: than as a patch in whichever module renders it.
    foundational_floor: bool = False
    typical_question_time_s: int = 300
    ontology_version: str = "1.0"


class ConceptEdge(BaseModel):
    src: str
    dst: str
    kind: EdgeKind
    #: 0–1: how hard a dependency. A 0.9 prerequisite is genuinely blocking; a
    #: 0.4 one is a correlation the bottleneck walk should discount, which is
    #: why §6.8 ranks by strength-decayed count rather than raw count.
    strength: float = Field(ge=0.0, le=1.0, default=1.0)
    ontology_version: str = "1.0"

    @property
    def is_prerequisite(self) -> bool:
        return self.kind is EdgeKind.prerequisite_of
