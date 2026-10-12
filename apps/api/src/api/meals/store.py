"""The Supabase side of a meal-planning run: what the household entered, what
it was shown lately, and the session and options a run saves.

Everything goes through the user's own client, so row level security applies."""

from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from api.meals.schemas import MEALS_BY_COUNT, NutritionGoals, PlanInputs, PlanResult, Served
from api.runs.data import MealType
from supabase import AsyncClient

# Options that were never put in front of the user.
_NOT_SHOWN = "queued"


class MealStore(Protocol):
    async def inputs(
        self, *, plan_days: int | None, meal_types: list[MealType] | None
    ) -> PlanInputs:
        """The household's saved details. The two arguments replace the saved
        plan length and meals per day for this run."""
        ...

    async def open_session(self, inputs: PlanInputs, overrides: dict[str, Any]) -> str: ...

    async def save_options(
        self, session_id: str, inputs: PlanInputs, result: PlanResult
    ) -> list[dict[str, Any]]:
        """Saves the checked recipes as meal options and marks the session
        ready. Returns the saved rows."""
        ...

    async def fail_session(self, session_id: str, message: str) -> None: ...

    async def session(self, session_id: str) -> dict[str, Any] | None:
        """A session with its options, or None if it isn't this user's."""
        ...


def option_rows(inputs: PlanInputs, result: PlanResult) -> list[dict[str, Any]]:
    """One meal_options row per checked recipe. The best `plan_days` of each
    meal type are shown, one per day. The rest wait as alternatives."""
    rows = []
    for meal_type, meals in result.meals.items():
        for position, meal in enumerate(meals):
            recipe = meal.recipe
            shown = position < inputs.plan_days
            rows.append(
                {
                    "recipe_id": str(recipe.id),
                    "title": recipe.name,
                    "image_url": recipe.image_url,
                    "cook_time_minutes": recipe.total_min,
                    "servings": recipe.servings,
                    "nutrition": {
                        "calories": recipe.calories,
                        "protein_g": recipe.protein_g,
                        "carbs_g": recipe.carbs_g,
                        "fat_g": recipe.fat_g,
                        "fiber_g": recipe.fiber_g,
                        "sodium_mg": recipe.sodium_mg,
                    },
                    # Only recipes that passed the check get this far, and the
                    # table refuses any other value.
                    "allergen_safe": True,
                    "compliance": meal.compliance,
                    "meal_type": meal_type,
                    "day_index": position if shown else None,
                    "rank": position + 1,
                    "is_headline": shown,
                    "status": "shown" if shown else _NOT_SHOWN,
                }
            )
    return rows


class SupabaseMealStore:
    def __init__(self, db: AsyncClient, user_id: str, cooling_days: int) -> None:
        self._db = db
        self._user_id = user_id
        self._cooling_days = cooling_days

    async def _one(self, table: str) -> dict[str, Any]:
        # RLS returns only this user's row. A new user has none yet.
        res = await self._db.table(table).select("*").limit(1).execute()
        return res.data[0] if res.data else {}

    async def inputs(
        self, *, plan_days: int | None, meal_types: list[MealType] | None
    ) -> PlanInputs:
        allergies = (await self._db.table("my_allergies").select("allergen, kind").execute()).data
        preferences = await self._one("preferences")
        goals = await self._one("nutrition_goals")
        since = datetime.now(UTC) - timedelta(days=self._cooling_days)
        served = await (
            self._db.table("meal_options")
            .select("recipe_id, title")
            .neq("status", _NOT_SHOWN)
            .gte("updated_at", since.isoformat())
            .execute()
        )
        saved = {
            key: preferences[key]
            for key in PlanInputs.model_fields
            if preferences.get(key) is not None
        }
        return PlanInputs.model_validate(
            saved
            | {
                "common_allergens": [a["allergen"] for a in allergies if a["kind"] == "common"],
                "custom_allergens": [a["allergen"] for a in allergies if a["kind"] == "custom"],
                "plan_days": plan_days or preferences.get("plan_days") or 7,
                "meal_types": meal_types or MEALS_BY_COUNT[preferences.get("meals_per_day") or 3],
                "nutrition": NutritionGoals.model_validate(goals) if goals else None,
                "recently_served": list(
                    {row["recipe_id"]: Served.model_validate(row) for row in served.data}.values()
                ),
            }
        )

    async def open_session(self, inputs: PlanInputs, overrides: dict[str, Any]) -> str:
        preferences = inputs.model_dump(
            exclude={"common_allergens", "custom_allergens", "nutrition", "recently_served"}
        )
        row = {
            "user_id": self._user_id,
            "status": "pending",
            "allergies_snapshot": inputs.common_allergens + inputs.custom_allergens,
            "preferences_snapshot": preferences,
            "nutrition_snapshot": inputs.nutrition.model_dump() if inputs.nutrition else {},
            "overrides": overrides,
        }
        return (await self._db.table("meal_option_sessions").insert(row).execute()).data[0]["id"]

    async def save_options(
        self, session_id: str, inputs: PlanInputs, result: PlanResult
    ) -> list[dict[str, Any]]:
        owner = {"session_id": session_id, "user_id": self._user_id}
        rows = [owner | row for row in option_rows(inputs, result)]
        saved = (await self._db.table("meal_options").insert(rows).execute()).data if rows else []
        await (
            self._db.table("meal_option_sessions")
            .update({"status": "ready"})
            .eq("id", session_id)
            .execute()
        )
        return saved

    async def fail_session(self, session_id: str, message: str) -> None:
        await (
            self._db.table("meal_option_sessions")
            .update({"status": "failed", "error_message": message})
            .eq("id", session_id)
            .execute()
        )

    async def session(self, session_id: str) -> dict[str, Any] | None:
        res = await (
            self._db.table("meal_option_sessions")
            .select("id, status, error_message, preferences_snapshot, meal_options(*)")
            .eq("id", session_id)
            .execute()
        )
        return res.data[0] if res.data else None
