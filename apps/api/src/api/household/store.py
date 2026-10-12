"""The Supabase side of what a household saves about itself.

Everything a user owns goes through the user's own client, so row level security
applies. The common allergen list is the one thing read without a user."""

from typing import Protocol

from postgrest.exceptions import APIError

from api.household.schemas import Allergen, Allergy, NutritionTargets, Preferences
from supabase import AsyncClient

_INVALID_VALUE = "22023"  # raised by the database's own term checks
_CHECK = "23514"
_UNIQUE = "23505"
_FOREIGN_KEY = "23503"

_PREFERENCES = ", ".join(Preferences.model_fields)
_TARGETS = ", ".join(NutritionTargets.model_fields)

# The database names the column in its message. The user knows it by its label.
_LIST_LABELS = {
    "diet_styles": "Diet",
    "liked_foods": "Liked foods",
    "disliked_foods": "Disliked foods",
    "liked_cuisines": "Liked cuisines",
    "disliked_cuisines": "Disliked cuisines",
}


class Rejected(Exception):
    """The database refused a value. The message is fit to show the user."""


class UnknownAllergen(Exception):
    """Not one of the common allergens."""


def _rejected(exc: APIError) -> Rejected:
    if exc.code != _INVALID_VALUE or not exc.message:
        return Rejected("That value is not allowed.")
    message = exc.message.removeprefix("Invalid preference ")
    for column, label in _LIST_LABELS.items():
        if message.startswith(f"{column}: "):
            return Rejected(f"{label}: {message.removeprefix(f'{column}: ')}.")
    return Rejected(f"{message}.")


class HouseholdStore(Protocol):
    async def preferences(self) -> Preferences | None:
        """None until the user has saved something."""
        ...

    async def save_preferences(self, preferences: Preferences) -> Preferences:
        """Returns what was stored: the lists come back cleaned and sorted."""
        ...

    async def allergies(self) -> list[Allergy]: ...

    async def add_common_allergy(self, allergen_id: str) -> None:
        """Adding one the user already has changes nothing."""
        ...

    async def add_custom_allergy(self, name: str) -> None:
        """A name the common list knows, such as 'dairy', is stored as the
        common allergen instead."""
        ...

    async def nutrition(self) -> NutritionTargets | None: ...

    async def save_nutrition(self, targets: NutritionTargets) -> NutritionTargets: ...


class SupabaseHouseholdStore:
    def __init__(self, db: AsyncClient, user_id: str) -> None:
        self._db = db
        self._user = {"user_id": user_id}

    async def preferences(self) -> Preferences | None:
        res = await self._db.table("preferences").select(_PREFERENCES).limit(1).execute()
        return Preferences.model_validate(res.data[0]) if res.data else None

    async def save_preferences(self, preferences: Preferences) -> Preferences:
        # Only these columns are sent, so shopping_mode and auto_buy keep their values.
        row = self._user | preferences.model_dump()
        try:
            res = await self._db.table("preferences").upsert(row, on_conflict="user_id").execute()
        except APIError as exc:
            if exc.code in (_INVALID_VALUE, _CHECK):
                raise _rejected(exc) from exc
            raise
        return Preferences.model_validate(res.data[0])

    async def allergies(self) -> list[Allergy]:
        res = await (
            self._db.table("my_allergies")
            .select("allergen, label, kind")
            .order("created_at")
            .execute()
        )
        return [Allergy.model_validate(row) for row in res.data]

    async def add_common_allergy(self, allergen_id: str) -> None:
        row = self._user | {"allergen_id": allergen_id}
        try:
            await self._db.table("user_allergens").insert(row).execute()
        except APIError as exc:
            if exc.code == _FOREIGN_KEY:
                raise UnknownAllergen(allergen_id) from exc
            if exc.code != _UNIQUE:
                raise

    async def add_custom_allergy(self, name: str) -> None:
        try:
            await (
                self._db.table("user_custom_allergens")
                .insert(self._user | {"name": name})
                .execute()
            )
        except APIError as exc:
            if exc.code in (_INVALID_VALUE, _CHECK):
                raise _rejected(exc) from exc
            if exc.code != _UNIQUE:
                raise

    async def nutrition(self) -> NutritionTargets | None:
        res = await self._db.table("nutrition_goals").select(_TARGETS).limit(1).execute()
        return NutritionTargets.model_validate(res.data[0]) if res.data else None

    async def save_nutrition(self, targets: NutritionTargets) -> NutritionTargets:
        # The optional columns (fiber, sodium, body stats) are left as they are.
        row = self._user | targets.model_dump()
        try:
            res = await (
                self._db.table("nutrition_goals").upsert(row, on_conflict="user_id").execute()
            )
        except APIError as exc:
            if exc.code == _CHECK:
                raise _rejected(exc) from exc
            raise
        return NutritionTargets.model_validate(res.data[0])


class AllergenList:
    """The common allergens. Anyone may read them, signed in or not."""

    def __init__(self, db: AsyncClient) -> None:
        self._db = db

    async def all(self) -> list[Allergen]:
        res = await self._db.table("allergens").select("id, label").order("sort").execute()
        return [Allergen.model_validate(row) for row in res.data]
