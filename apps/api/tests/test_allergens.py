"""How a household's allergies turn into what it can't have. The reference
file's own matching is taken as supplied; this covers what the app does with it."""

import json
from pathlib import Path

import pytest

from api import allergens
from api.allergens import load_matcher
from api.allergens.matcher import phrase
from api.allergens.profile import (
    DEFINITE,
    Household,
    blocking_hits,
    custom_matches,
    resolve_household,
)
from api.allergens.vocabulary import IngredientVocabulary

NAMES = [
    "vanilla yogurt", "margarine", "coconut milk", "eggplant", "butter bean", "tomato soup",
    "flour", "pearl barley", "crabmeat", "clam", "soymilk", "cool whip", "cornstarch",
    "peppercorn", "peanut butter", "dijon mustard", "strawberry jam", "rice",
]  # fmt: skip


@pytest.fixture(scope="module")
def matcher():
    return load_matcher()


@pytest.fixture(scope="module")
def vocabulary(matcher):
    return IngredientVocabulary(matcher, NAMES)


def blocked(matcher, vocabulary, common=(), custom=()):
    return set(vocabulary.blocked(resolve_household(matcher, common, custom)))


def test_added_terms_are_written_the_way_the_matcher_reads_them():
    extras = json.loads((Path(allergens.__file__).parent / "allergen_extras.json").read_text())
    assert [t["phrase"] for t in extras["terms"] if phrase(t["phrase"]) != t["phrase"]] == []


def test_common_allergens_map_to_reference_groups(matcher):
    household = resolve_household(matcher, ["shellfish", "wheat", "tree_nut"], [])
    assert household.groups == {
        "crustaceans": None,
        "molluscs": None,
        "gluten_cereals": ("wheat",),
        "tree_nuts": None,
    }


def test_gluten_widens_a_wheat_only_scope(matcher):
    assert resolve_household(matcher, ["wheat", "gluten"], []).groups == {"gluten_cereals": None}


def test_custom_allergen_that_names_a_group_becomes_that_group(matcher):
    household = resolve_household(matcher, [], ["mustard", "strawberries"])
    assert household.groups == {"mustard": None}
    assert household.custom == ("strawberry",)


def test_an_unknown_common_id_is_not_dropped(matcher):
    # An id added to public.allergens later still has to count.
    assert resolve_household(matcher, ["celery"], []).groups == {"celery": None}


def test_no_allergies_blocks_nothing(matcher, vocabulary):
    assert not Household()
    assert blocked(matcher, vocabulary) == set()


def test_milk_blocks_what_contains_it_and_what_may(matcher, vocabulary):
    names = blocked(matcher, vocabulary, ["milk"])
    # "margarine" is only "check the label", which is blocked too.
    assert {"vanilla yogurt", "margarine", "cool whip"} <= names
    # Named after milk or butter without containing either.
    assert not names & {"coconut milk", "butter bean", "peanut butter", "eggplant"}


def test_whole_kinds_of_food_are_not_blocked(matcher, vocabulary):
    # The reference lists "soup" as a broad category that may hold milk.
    assert "tomato soup" not in blocked(matcher, vocabulary, ["milk"])


def test_wheat_only_leaves_other_cereals(matcher, vocabulary):
    assert {"flour", "pearl barley"} & blocked(matcher, vocabulary, ["wheat"]) == {"flour"}
    assert {"flour", "pearl barley"} <= blocked(matcher, vocabulary, ["gluten"])


def test_shellfish_is_crustaceans_and_molluscs(matcher, vocabulary):
    assert {"crabmeat", "clam"} <= blocked(matcher, vocabulary, ["shellfish"])


def test_added_terms_fill_gaps_in_the_reference(matcher, vocabulary):
    assert "soymilk" in blocked(matcher, vocabulary, ["soy"])


def test_custom_allergen_matches_by_name(matcher, vocabulary):
    assert blocked(matcher, vocabulary, custom=["strawberry"]) == {"strawberry jam"}
    # Inside a longer word too, which over-matches on purpose.
    assert blocked(matcher, vocabulary, custom=["corn"]) == {"cornstarch", "peppercorn"}


def test_short_custom_terms_only_match_whole_words():
    household = Household(custom=("pea",))
    assert custom_matches("split peas", household) == ["pea"]
    assert custom_matches("peanut butter", household) == []


def test_each_hit_is_judged_on_its_own(matcher):
    # The matcher's summary keeps only barley here, which a wheat-only
    # household may eat, and would lose the flour.
    household = resolve_household(matcher, ["wheat"], [])
    hits = [hit for name in ["flour", "pearl barley"] for hit in matcher.match_item(name)[0]]
    assert [hit["phrase"] for hit in blocking_hits(hits, household)] == ["flour"]


def test_definite_tiers_ignore_cooking_words(matcher):
    household = resolve_household(matcher, ["gluten", "milk"], [])
    step = matcher.match_item("Roll into balls and glaze.")[0]
    assert blocking_hits(step, household, DEFINITE) == []
    step = matcher.match_item("Stir in the butter.")[0]
    assert [hit["phrase"] for hit in blocking_hits(step, household, DEFINITE)] == ["butter"]
