"""Concept shape and alias normalisation (M04 §5.2, FR-4.21).

`normalise_alias` has to be identical on both sides of
`POST /v1/concepts/resolve`, so it is tested where it is defined rather than in
whichever caller happened to notice first.
"""

from __future__ import annotations

import pytest

from ai_core.concepts import Concept, ConceptEdge, EdgeKind, normalise_alias


@pytest.mark.parametrize(
    "written",
    [
        "Dynamic Programming",
        "dynamic programming",
        "DYNAMIC  PROGRAMMING",
        "Dynamic-Programming",
        "dynamic, programming",
    ],
)
def test_the_ways_a_student_types_one_topic_collapse_to_one_key(written):
    assert normalise_alias(written) == "dynamic programming"


def test_accents_are_stripped():
    assert normalise_alias("Naïve Bayes") == normalise_alias("naive bayes")


def test_near_misses_are_not_collapsed():
    """`tree` and `trie` are one edit apart and are different concepts. A
    resolver that guesses is worse than one that returns `unresolved`
    (EC-4.18) — a caller can degrade a term to zero weight and say so, but it
    cannot un-learn a wrong match."""
    assert normalise_alias("tries") != normalise_alias("trees")


def test_an_edge_knows_whether_it_is_a_prerequisite():
    edge = ConceptEdge(
        src="concept:recursion",
        dst="concept:dynamic_programming",
        kind=EdgeKind.prerequisite_of,
        strength=0.9,
    )
    assert edge.is_prerequisite is True

    assert ConceptEdge(src="a", dst="b", kind=EdgeKind.co_occurs_with).is_prerequisite is False


def test_edge_strength_is_bounded():
    with pytest.raises(ValueError):
        ConceptEdge(src="a", dst="b", kind=EdgeKind.prerequisite_of, strength=1.4)


def test_a_concept_defaults_to_not_being_a_floor():
    """`foundational_floor` is opt-in: the failure mode is a bottleneck query
    that returns nothing, not one that says "work on variables"."""
    c = Concept(id="concept:x", name="X", domain="dsa", level="intermediate")
    assert c.foundational_floor is False
