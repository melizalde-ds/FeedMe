"""What goes into a meal-planning run and what comes out of it."""

from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from api.recipes.client import RecipeCard
from api.runs.data import MealType

# Which meals a day has, by preferences.meals_per_day.
MEALS_BY_COUNT: dict[int, list[MealType]] = {
    1: ["dinner"],
    2: ["lunch", "dinner"],
    3: ["breakfast", "lunch", "dinner"],
    4: ["breakfast", "lunch", "dinner", "snack"],
}


class NutritionGoals(BaseModel):
    """Per person, per day."""

    calories: int | None = None
    protein_g: int | None = None
    carbs_g: int | None = None
    fat_g: int | None = None


class Served(BaseModel):
    """A meal the user was shown lately, so it isn't suggested again yet."""

    recipe_id: str
    title: str


class PlanInputs(BaseModel):
    """Everything one run reads about a household. Saved with the session, so a
    reloaded session shows what it was planned from."""

    # Ids from public.allergens, and the user's own terms.
    common_allergens: list[str] = []
    custom_allergens: list[str] = []
    diet_styles: list[str] = []
    liked_foods: list[str] = []
    disliked_foods: list[str] = []
    liked_cuisines: list[str] = []
    disliked_cuisines: list[str] = []
    household_size: int = 1
    weekly_budget: float | None = None
    max_cook_time_minutes: int | None = None
    plan_days: int = 7
    meal_types: list[MealType] = MEALS_BY_COUNT[3]
    nutrition: NutritionGoals | None = None
    recently_served: list[Served] = []


@dataclass(frozen=True)
class Checked:
    """A recipe that passed the allergen and diet check, with the evidence."""

    recipe: RecipeCard
    compliance: dict[str, Any]


@dataclass
class PlanResult:
    # Best first, per meal type. A recipe is in one meal type only.
    meals: dict[MealType, list[Checked]] = field(default_factory=dict)
    # Things the user should know: a rule that can't be verified, a meal type
    # that came up short, a fallback that was used.
    warnings: list[str] = field(default_factory=list)
