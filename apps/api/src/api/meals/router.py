"""HTTP routes for meal planning: have the meals for a plan chosen and checked,
and read a set of choices again later."""

from typing import Annotated, Any, Self
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from api.agent.providers import get_provider
from api.agent.providers.base import ProviderError
from api.auth import CurrentUser
from api.db import UserDB
from api.meals.pipeline import Limits, MealPlanner, PlannerUnavailable
from api.meals.query import LlmQueryWriter, QueryWriter, TemplateQueryWriter
from api.meals.rerank import PassThroughReranker, Reranker
from api.meals.safety import SafetyChecker
from api.meals.services import MealServices
from api.meals.store import MealStore, SupabaseMealStore
from api.recipes.client import RecipeCard, RecipeClient, RecipeNotFound, RecipesUnavailable
from api.runs.data import MealType
from api.settings import Settings, get_settings

router = APIRouter(prefix="/api", tags=["meals"])

Config = Annotated[Settings, Depends(get_settings)]


def get_meal_store(user: CurrentUser, db: UserDB, settings: Config) -> MealStore:
    return SupabaseMealStore(db, user.id, settings.cooling_days)


def get_meal_services(request: Request) -> MealServices:
    return request.app.state.meals


Services = Annotated[MealServices, Depends(get_meal_services)]


def get_query_writer(settings: Config) -> QueryWriter:
    if settings.llm_provider == "scripted":
        # No model is set up: fixed searches, so the planner still runs offline.
        return TemplateQueryWriter()
    model_id = settings.meal_query_model_id or settings.bedrock_model_id
    try:
        return LlmQueryWriter(
            get_provider(settings.model_copy(update={"bedrock_model_id": model_id}))
        )
    except ProviderError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


def get_reranker() -> Reranker:
    """Return the real reranker here once there is one."""
    return PassThroughReranker()


def get_recipe_cards(services: Services) -> RecipeClient:
    return services.recipes


def get_planner(
    services: Services,
    settings: Config,
    writer: Annotated[QueryWriter, Depends(get_query_writer)],
    reranker: Annotated[Reranker, Depends(get_reranker)],
) -> MealPlanner:
    try:
        checker = SafetyChecker(
            services.matcher,
            services.book,
            services.judge(),
            allergen_threshold=settings.allergen_block_probability,
            diet_threshold=settings.diet_block_probability,
        )
        embedder = services.embedder()
    except PlannerUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return MealPlanner(
        matcher=services.matcher,
        recipes=services.recipes,
        pantry=services.pantry,
        writer=writer,
        embedder=embedder,
        reranker=reranker,
        checker=checker,
        limits=Limits(
            ideas=settings.meal_ideas,
            candidates=settings.meal_candidates,
            batch=settings.meal_check_batch,
            keep=settings.meal_options,
            low_carb_share=settings.low_carb_max_share,
        ),
    )


Store = Annotated[MealStore, Depends(get_meal_store)]
Planner = Annotated[MealPlanner, Depends(get_planner)]
Cards = Annotated[RecipeClient, Depends(get_recipe_cards)]


class PlanMeals(BaseModel):
    """Both replace what is saved in the user's preferences, for this run only.
    Allergies can't be changed here."""

    plan_days: int | None = Field(None, ge=1, le=31)
    meal_types: list[MealType] | None = Field(None, min_length=1)

    @model_validator(mode="after")
    def _each_meal_once(self) -> Self:
        if self.meal_types and len(set(self.meal_types)) != len(self.meal_types):
            raise ValueError("A meal type is listed twice")
        return self


class MealOption(BaseModel):
    id: str
    recipe_id: str
    meal_type: MealType | None
    # The day of the plan this meal is suggested for. None for an alternative.
    day_index: int | None
    rank: int
    is_headline: bool
    status: str
    title: str
    image_url: str | None
    cook_time_minutes: int | None
    servings: int | None
    # Per serving, as given by the recipe. Estimates, not verified.
    nutrition: dict[str, Any]
    # What the allergen and diet check found. Not medical advice.
    compliance: dict[str, Any]
    ingredients: list[str] = []
    instructions: list[str] = []


class MealOptions(BaseModel):
    session_id: str
    status: str
    plan_days: int
    # Best first within each meal type.
    meals: dict[MealType, list[MealOption]]
    warnings: list[str] = []


def _options(
    rows: list[dict[str, Any]], cards: dict[int, RecipeCard]
) -> dict[MealType, list[MealOption]]:
    meals: dict[MealType, list[MealOption]] = {}
    for row in sorted(rows, key=lambda row: row["rank"]):
        card = cards.get(int(row["recipe_id"])) if row["recipe_id"].isdigit() else None
        option = MealOption(
            **{name: row.get(name) for name in MealOption.model_fields if name in row},
            ingredients=(card.ingredients_raw or card.ingredients) if card else [],
            instructions=card.instructions if card else [],
        )
        if option.meal_type:
            meals.setdefault(option.meal_type, []).append(option)
    return meals


@router.post("/meal-options", status_code=status.HTTP_201_CREATED)
async def plan_meals(store: Store, planner: Planner, body: PlanMeals | None = None) -> MealOptions:
    """Chooses meals for the user's household: several per meal type, each
    checked against the household's allergies and diet. The best ones are set
    on the days of the plan and the rest are alternatives.

    Reads the user's saved allergies, preferences and nutrition goals, and
    leaves out what they were shown in the last two weeks."""
    body = body or PlanMeals()
    inputs = await store.inputs(plan_days=body.plan_days, meal_types=body.meal_types)
    session_id = await store.open_session(inputs, body.model_dump(exclude_none=True))
    try:
        result = await planner.plan(inputs)
    except PlannerUnavailable as exc:
        await store.fail_session(session_id, str(exc))
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except Exception:
        await store.fail_session(session_id, "The meals could not be planned")
        raise
    if not any(result.meals.values()):
        message = "No recipe fits this household's allergies and diet."
        await store.fail_session(session_id, message)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, message)

    rows = await store.save_options(session_id, inputs, result)
    cards = {meal.recipe.id: meal.recipe for meals in result.meals.values() for meal in meals}
    return MealOptions(
        session_id=session_id,
        status="ready",
        plan_days=inputs.plan_days,
        meals=_options(rows, cards),
        warnings=result.warnings,
    )


@router.get("/meal-options/{session_id}")
async def get_meal_options(session_id: UUID, store: Store, recipes: Cards) -> MealOptions:
    """A set of choices made earlier, as it was saved. The warnings of the run
    are not kept."""
    session = await store.session(str(session_id))
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meal options not found")
    rows = session["meal_options"]
    ids = [int(row["recipe_id"]) for row in rows if row["recipe_id"].isdigit()]
    try:
        try:
            cards = await recipes.cards(ids)
        except RecipeNotFound as exc:
            # A recipe was removed since: show the option without its details.
            cards = await recipes.cards(set(ids) - set(exc.ids))
    except RecipesUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return MealOptions(
        session_id=session["id"],
        status=session["status"],
        plan_days=(session.get("preferences_snapshot") or {}).get("plan_days") or 7,
        meals=_options(rows, cards),
    )
