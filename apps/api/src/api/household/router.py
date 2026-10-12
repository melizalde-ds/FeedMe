"""HTTP routes for what a household saves about itself: preferences, allergies
and nutrition targets. The meal planner reads them on its next run.

A refusal answers 422 with a sentence in `detail` that can be shown to the user."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from api.auth import CurrentUser
from api.db import AnonDB, UserDB
from api.household.schemas import AddAllergy, Allergen, Allergy, NutritionTargets, Preferences
from api.household.store import (
    AllergenList,
    HouseholdStore,
    Rejected,
    SupabaseHouseholdStore,
    UnknownAllergen,
)

router = APIRouter(prefix="/api", tags=["household"])


def get_household_store(user: CurrentUser, db: UserDB) -> HouseholdStore:
    return SupabaseHouseholdStore(db, user.id)


def get_allergen_list(db: AnonDB) -> AllergenList:
    return AllergenList(db)


Store = Annotated[HouseholdStore, Depends(get_household_store)]
Allergens = Annotated[AllergenList, Depends(get_allergen_list)]


def _refused(problem: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)


@router.get("/preferences")
async def get_preferences(store: Store) -> Preferences | None:
    """The user's saved preferences, or null if they never saved any."""
    return await store.preferences()


@router.put("/preferences")
async def put_preferences(body: Preferences, store: Store) -> Preferences:
    """Replaces the preferences. The lists come back as they were stored:
    lowercased, trimmed, sorted and without duplicates."""
    if problem := body.problem():
        raise _refused(problem)
    try:
        return await store.save_preferences(body)
    except Rejected as exc:
        raise _refused(str(exc)) from exc


@router.get("/allergens")
async def list_allergens(allergens: Allergens) -> list[Allergen]:
    """The common allergens to choose from. Needs no sign-in, so the form can
    show them to a guest."""
    return await allergens.all()


@router.get("/allergies")
async def list_allergies(store: Store) -> list[Allergy]:
    return await store.allergies()


@router.post("/allergies", status_code=status.HTTP_201_CREATED)
async def add_allergy(body: AddAllergy, store: Store) -> list[Allergy]:
    """Adds one allergy and answers with the whole list. Allergies can't be
    changed or removed afterwards, so there is no route for that."""
    name = (body.name or "").strip()
    if bool(body.allergen_id) == bool(name):
        raise _refused("Send either a common allergen or a name, not both.")
    try:
        if body.allergen_id:
            await store.add_common_allergy(body.allergen_id)
        else:
            await store.add_custom_allergy(name)
    except UnknownAllergen as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That allergen is not on the list.") from exc
    except Rejected as exc:
        raise _refused(str(exc)) from exc
    return await store.allergies()


@router.get("/nutrition-goals")
async def get_nutrition_goals(store: Store) -> NutritionTargets | None:
    """The user's daily targets, or null if they never saved any."""
    return await store.nutrition()


@router.put("/nutrition-goals")
async def put_nutrition_goals(body: NutritionTargets, store: Store) -> NutritionTargets:
    if problem := body.problem():
        raise _refused(problem)
    try:
        return await store.save_nutrition(body)
    except Rejected as exc:
        raise _refused(str(exc)) from exc
