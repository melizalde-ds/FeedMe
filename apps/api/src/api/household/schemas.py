"""What a household saves about itself: its preferences, its allergies and its
nutrition targets. The meal planner reads all three."""

from typing import Literal

from pydantic import BaseModel


class Preferences(BaseModel):
    diet_styles: list[str] = []
    liked_foods: list[str] = []
    disliked_foods: list[str] = []
    liked_cuisines: list[str] = []
    disliked_cuisines: list[str] = []
    household_size: int = 1
    weekly_budget: float | None = None
    max_cook_time_minutes: int | None = None
    plan_days: int = 7
    meals_per_day: int = 3

    def problem(self) -> str | None:
        """Why the table would refuse these numbers, in words for the user. The
        lists are checked by the database, which owns the rules for them."""
        if not 1 <= self.household_size <= 20:
            return "Household size must be between 1 and 20."
        if self.weekly_budget is not None and self.weekly_budget < 0:
            return "Weekly budget can't be negative."
        if self.max_cook_time_minutes is not None and self.max_cook_time_minutes <= 0:
            return "Cooking time must be more than 0 minutes."
        if not 1 <= self.plan_days <= 31:
            return "A plan must be between 1 and 31 days long."
        if not 1 <= self.meals_per_day <= 4:
            return "Meals per day must be between 1 and 4."
        return None


class NutritionTargets(BaseModel):
    """Per person, per day."""

    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int

    def problem(self) -> str | None:
        """The same rules as the table's own checks."""
        if self.calories < 1200:
            return "Calories must be at least 1200."
        if min(self.protein_g, self.carbs_g, self.fat_g) < 0:
            return "Protein, carbs and fat can't be negative."
        from_macros = self.protein_g * 4 + self.carbs_g * 4 + self.fat_g * 9
        if abs(from_macros - self.calories) > self.calories * 0.10:
            return (
                f"Protein, carbs and fat add up to {from_macros} kcal, which is more "
                f"than 10% away from the {self.calories} kcal target."
            )
        return None


class Allergen(BaseModel):
    """One of the common allergens anyone can pick."""

    id: str
    label: str


class Allergy(BaseModel):
    """An allergen this user avoids. For a custom one, `allergen` and `label`
    are both the term the user typed, as it was cleaned."""

    allergen: str
    label: str
    kind: Literal["common", "custom"]


class AddAllergy(BaseModel):
    """Either a common allergen's id, or a name the user typed."""

    allergen_id: str | None = None
    name: str | None = None
