"""An in-memory stand-in for the tables a household saves itself to. It keeps
the few database rules the routes rely on: cleaned lists, known names stored as
common allergens, and no way to take an allergy away."""

from api.household.schemas import Allergen, Allergy, NutritionTargets, Preferences
from api.household.store import Rejected, UnknownAllergen

COMMON = {"milk": "Milk / dairy", "peanut": "Peanuts", "tree_nut": "Tree nuts"}
ALIASES = {"dairy": "milk", "peanuts": "peanut"}
_LISTS = ["diet_styles", "liked_foods", "disliked_foods", "liked_cuisines", "disliked_cuisines"]


def _clean(term: str) -> str:
    return " ".join(term.lower().split())


class FakeHouseholdStore:
    def __init__(self) -> None:
        self.saved_preferences: Preferences | None = None
        self.saved_nutrition: NutritionTargets | None = None
        self.common: list[str] = []
        self.custom: list[str] = []

    async def preferences(self):
        return self.saved_preferences

    async def save_preferences(self, preferences):
        cleaned = {name: sorted({_clean(t) for t in getattr(preferences, name)}) for name in _LISTS}
        for terms in cleaned.values():
            for term in terms:
                if len(term) < 2:
                    raise Rejected(f'Liked foods: "{term}" is too short.')
        self.saved_preferences = preferences.model_copy(update=cleaned)
        return self.saved_preferences

    async def allergies(self):
        return [Allergy(allergen=a, label=COMMON[a], kind="common") for a in self.common] + [
            Allergy(allergen=name, label=name, kind="custom") for name in self.custom
        ]

    async def add_common_allergy(self, allergen_id):
        if allergen_id not in COMMON:
            raise UnknownAllergen(allergen_id)
        if allergen_id not in self.common:
            self.common.append(allergen_id)

    async def add_custom_allergy(self, name):
        name = _clean(name)
        if len(name) < 2:
            raise Rejected(f'Allergen "{name}" is too short.')
        if name in ALIASES or name in COMMON:
            await self.add_common_allergy(ALIASES.get(name, name))
        elif name not in self.custom:
            self.custom.append(name)

    async def nutrition(self):
        return self.saved_nutrition

    async def save_nutrition(self, targets):
        self.saved_nutrition = targets
        return targets


class FakeAllergenList:
    async def all(self):
        return [Allergen(id=allergen_id, label=label) for allergen_id, label in COMMON.items()]
