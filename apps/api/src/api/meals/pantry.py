"""What the reference files make of every ingredient name in the recipes, and
the Qdrant filter a household's hard rules turn into.

The filter is the first gate. Putting "no peanuts" in the search text would
pull peanut recipes closer, so anything that must be left out is a filter."""

from collections.abc import Iterable
from typing import Any

from api.allergens.matcher import AllergenMatcher
from api.allergens.profile import Household
from api.allergens.vocabulary import IngredientVocabulary
from api.meals.diets import DietBook, DietRule
from api.runs.data import MealType

# Categories and tags that aren't a meal on their own. Sauces, drinks, dressings
# and spreads are already marked is_component by the recipe data.
_SWEETS = [
    "Dessert", "Drop Cookies", "Bar Cookie", "Pie", "Candy", "Frozen Desserts", "Cheesecake",
    "Tarts", "Gelatin", "Ice Cream", "Chocolate Chip Cookies", "Jellies",
]  # fmt: skip
_SWEET_TAGS = ["Dessert", "Cookie & Brownie", "Candy", "Frozen Desserts", "Cheesecake"]
_BAKERY = ["Breads", "Quick Breads", "Yeast Breads", "Sourdough Breads", "Scones"]
_NOT_A_MAIN = [*_SWEETS, *_BAKERY, "Breakfast", "Oatmeal", "Stocks"]
_MISFIT_CATEGORIES: dict[MealType, list[str]] = {
    "breakfast": [*_SWEETS, "Stocks"],
    "lunch": _NOT_A_MAIN,
    "dinner": _NOT_A_MAIN,
    "snack": ["Stocks"],
}
_MISFIT_TAGS: dict[MealType, list[str]] = {
    "breakfast": _SWEET_TAGS,
    "lunch": _SWEET_TAGS,
    "dinner": _SWEET_TAGS,
    "snack": [],
}


def _any(key: str, values: Iterable[Any]) -> dict[str, Any]:
    return {"key": key, "match": {"any": sorted(values)}}


class Pantry:
    def __init__(self, matcher: AllergenMatcher, book: DietBook, names: Iterable[str]) -> None:
        names = list(names)
        self.allergens = IngredientVocabulary(matcher, names)
        self._diet_groups = {name: book.groups(name) for name in names}

    def in_groups(self, groups: frozenset[str]) -> list[str]:
        """The ingredient names that belong to any of these diet groups."""
        return [name for name, found in self._diet_groups.items() if found & groups]

    def filter(
        self,
        meal_type: MealType,
        *,
        household: Household,
        rules: Iterable[DietRule],
        served: Iterable[int],
        low_carb_share: float,
    ) -> dict[str, Any]:
        """The Qdrant filter for one meal type: no allergen, nothing a diet
        rules out, nothing served lately, and nothing that isn't a meal."""
        rules = list(rules)
        names = set(self.allergens.blocked(household))
        must: list[dict[str, Any]] = []
        must_not: list[dict[str, Any]] = [
            {"key": "is_component", "match": {"value": True}},
            {"key": "has_alcohol", "match": {"value": True}},
        ]
        for rule in rules:
            names.update(self.in_groups(rule.groups))
            for first, second in rule.pairs:
                a, b = self.in_groups(first), self.in_groups(second)
                if a and b:
                    # Leaves out a recipe that has one of each.
                    must_not.append({"must": [_any("ingredients", a), _any("ingredients", b)]})
            if rule.low_carb:
                must.append({"key": "carb_pct", "range": {"lte": low_carb_share}})
        if names:
            must_not.append(_any("ingredients", names))
        if served := sorted(set(served)):
            must_not.append({"has_id": served})
        if categories := _MISFIT_CATEGORIES[meal_type]:
            must_not.append(_any("category", categories))
        if tags := _MISFIT_TAGS[meal_type]:
            must_not.append(_any("keywords", tags))
        return {"must": must, "must_not": must_not}
