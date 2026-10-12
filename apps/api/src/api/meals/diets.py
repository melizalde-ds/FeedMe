"""Diet styles as hard rules: which ingredients a diet rules out.

A diet is a set of food groups to avoid. Some groups are allergen groups (milk,
fish), the rest come from diet_reference.json (pork, poultry, alcohol). Both
files are read by the same matcher. A style this module doesn't know is left
to the query model as a preference."""

import json
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from api.allergens.matcher import AllergenMatcher, phrase

DIET_REFERENCE = Path(__file__).with_name("diet_reference.json")
# A diet avoids what is or usually is the food. "Check the label" is left to Jev.
PRESENT = frozenset({"declared", "contains", "likely", "exempt_derivative"})

MEAT = frozenset({"red_meat", "pork", "poultry", "animal_product"})
SEAFOOD = frozenset({"fish", "crustaceans", "molluscs"})
# The allergen groups a diet can name.
_ALLERGEN_GROUPS = SEAFOOD | {"milk", "egg", "gluten_cereals"}


@dataclass(frozen=True)
class DietRule:
    style: str
    # What Jev is asked to find in a recipe, one question each. Jev answers a
    # question that joins several conditions badly, so each stays simple.
    avoids: tuple[str, ...] = ()
    groups: frozenset[str] = frozenset()
    # Groups that can't be in the same recipe, such as meat with dairy.
    pairs: tuple[tuple[frozenset[str], frozenset[str]], ...] = ()
    # The same pairs in words, for Jev: (one kind of food, the other kind).
    both: tuple[tuple[str, str], ...] = ()
    low_carb: bool = False
    # Set when a recipe can't show the diet is kept, and said to the user.
    caveat: str | None = None


RULES = {
    rule.style: rule
    for rule in [
        DietRule("vegetarian", ("meat, poultry, fish, shellfish or gelatin",), MEAT | SEAFOOD),
        DietRule(
            "vegan",
            ("any animal product: meat, poultry, fish, shellfish, dairy, eggs, honey or gelatin",),
            MEAT | SEAFOOD | {"milk", "egg", "honey"},
        ),
        DietRule("pescatarian", ("meat or poultry (fish and shellfish are allowed)",), MEAT),
        DietRule("dairy free", ("milk or any dairy product",), frozenset({"milk"})),
        DietRule(
            "gluten free",
            ("wheat, barley, rye, oats or anything made from them",),
            frozenset({"gluten_cereals"}),
        ),
        DietRule(
            "halal",
            (
                "pork or anything made from pork, such as bacon, ham or lard",
                "alcohol, such as wine, beer or spirits",
            ),
            frozenset({"pork", "alcohol"}),
            caveat="Halal: recipes with pork or alcohol are left out, but a recipe can't show "
            "how its meat was prepared. Check the meat you buy.",
        ),
        DietRule(
            "kosher",
            (
                "pork or anything made from pork, such as bacon, ham or lard",
                "shellfish, such as shrimp, crab, lobster, clams, mussels, oysters or squid",
            ),
            frozenset({"pork", "crustaceans", "molluscs"}),
            pairs=((frozenset({"red_meat", "poultry"}), frozenset({"milk"})),),
            both=(
                (
                    "meat or poultry, such as beef, lamb, chicken or turkey (fish is not meat)",
                    "milk or a dairy product, such as butter, cheese, cream or yogurt",
                ),
            ),
            caveat="Kosher: recipes with pork, shellfish, or meat with dairy are left out, but "
            "a recipe can't show certification. Check what you buy.",
        ),
        DietRule("low carb", low_carb=True),
    ]
}
_ALIASES = {"pescetarian": "pescatarian", "plant based": "vegan", "celiac": "gluten free"}


def split_styles(styles: Iterable[str]) -> tuple[list[DietRule], list[str]]:
    """The rules for the styles this module knows, and the styles it doesn't."""
    rules, unknown = {}, []
    for style in styles:
        key = " ".join(style.lower().replace("-", " ").split())
        key = _ALIASES.get(key, key)
        if key in RULES:
            rules[key] = RULES[key]
        elif key:
            unknown.append(style)
    return list(rules.values()), unknown


def load_diet_matcher(allergens: AllergenMatcher) -> AllergenMatcher:
    """A matcher for diet_reference.json. It borrows the allergen file's stopwords
    and known-safe list, which are about wording and not about allergens."""
    data = json.loads(DIET_REFERENCE.read_text(encoding="utf-8"))
    terms = [
        {"phrase": phrase(text), "group": group, "tier": tier}
        for group, tiers in data["terms"].items()
        for tier, texts in tiers.items()
        for text in texts
    ]
    negatives = [
        {"phrase": phrase(text), "not_groups": [group]}
        for group, texts in data["negatives"].items()
        for text in texts
    ]
    return AllergenMatcher(
        {
            "groups": data["groups"],
            "terms": terms,
            "negatives": negatives,
            "downgrade_words": data["downgrade_words"],
            "free_from_terms": data["free_from_terms"],
            "known_safe": allergens.lex["known_safe"],
            "stopwords": allergens.lex["stopwords"],
            "relations": [],
            "prefix_rules": [],
            "user_phrases": {},
            "umbrella_terms": {},
        }
    )


class DietBook:
    """Says which diet-relevant food groups an ingredient belongs to."""

    def __init__(self, allergens: AllergenMatcher) -> None:
        self._allergens = allergens
        self._diets = load_diet_matcher(allergens)

    def groups(self, ingredient: str) -> frozenset[str]:
        found = {
            hit.group
            for hit in self._allergens.match_item(ingredient)[0]
            if hit.group in _ALLERGEN_GROUPS and hit.tier in PRESENT
        }
        found |= {hit.group for hit in self._diets.match_item(ingredient)[0] if hit.tier in PRESENT}
        return frozenset(found)

    def broken(self, rule: DietRule, ingredients: Iterable[str]) -> list[str]:
        """The ingredients that break this rule, empty if the recipe keeps it."""
        by_name = {name: self.groups(name) for name in ingredients}
        breaking = [name for name, groups in by_name.items() if groups & rule.groups]
        for first, second in rule.pairs:
            a = [name for name, groups in by_name.items() if groups & first]
            b = [name for name, groups in by_name.items() if groups & second]
            if a and b:
                breaking += a + b
        return sorted(set(breaking))
