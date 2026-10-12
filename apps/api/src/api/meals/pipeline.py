"""Chooses the meals for a household, one pass per meal type:

    write the searches -> embed -> search Qdrant behind the hard filter
    -> rerank -> check the best with the reference files and Jev -> keep the top

Allergens are enforced three times: the Qdrant filter, the reference files on
the full recipe, and Jev. Nothing is returned that Jev did not answer for."""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from itertools import batched, zip_longest

from api.allergens.matcher import AllergenMatcher
from api.allergens.profile import Household, resolve_household
from api.meals.diets import DietRule, split_styles
from api.meals.embed import Embedder, EmbedderError
from api.meals.pantry import Pantry
from api.meals.query import QueryWriter
from api.meals.rerank import Reranker
from api.meals.safety import JudgeUnavailable, SafetyChecker
from api.meals.schemas import Checked, PlanInputs, PlanResult
from api.recipes.client import RecipeCard, RecipeClient, RecipesUnavailable
from api.runs.data import MealType

logger = logging.getLogger(__name__)


class PlannerUnavailable(Exception):
    """Something the planner can't work without could not be reached."""


@dataclass(frozen=True)
class Limits:
    # Different dishes searched per meal type.
    ideas: int = 4
    # Recipes kept per meal type after the searches are merged, and reranked.
    candidates: int = 50
    # Recipes sent through the safety check at a time, best first. More than
    # are kept, since the check drops some.
    batch: int = 15
    # Checked recipes kept per meal type.
    keep: int = 10
    low_carb_share: float = 0.26


def _interleave(found: Iterable[list[RecipeCard]]) -> list[RecipeCard]:
    """The best of each search, then the second best of each, and so on. Keeps
    the dishes varied, and drops a recipe or a name that came up twice."""
    merged: list[RecipeCard] = []
    ids: set[int] = set()
    names: set[str] = set()
    for row in zip_longest(*found):
        for recipe in row:
            if recipe is None or recipe.id in ids or recipe.name.lower() in names:
                continue
            ids.add(recipe.id)
            names.add(recipe.name.lower())
            merged.append(recipe)
    return merged


def describe(recipe: RecipeCard) -> str:
    """A recipe as one line of text, for the reranker."""
    parts = [recipe.name]
    if recipe.category:
        parts.append(recipe.category)
    if recipe.keywords:
        parts.append("Tags: " + ", ".join(recipe.keywords))
    parts.append("Ingredients: " + ", ".join(recipe.ingredients))
    if recipe.total_min:
        parts.append(f"Ready in {recipe.total_min} minutes")
    if recipe.calories:
        parts.append(f"{recipe.calories:.0f} calories per serving")
    return ". ".join(parts) + "."


def _in_order(order: list[int], count: int) -> list[int]:
    """A reranker's answer made safe to use: each position once, none missing."""
    seen = list(dict.fromkeys(i for i in order if isinstance(i, int) and 0 <= i < count))
    return seen + [i for i in range(count) if i not in set(seen)]


class MealPlanner:
    def __init__(
        self,
        *,
        matcher: AllergenMatcher,
        recipes: RecipeClient,
        pantry: Callable[[], Awaitable[Pantry]],
        writer: QueryWriter,
        embedder: Embedder,
        reranker: Reranker,
        checker: SafetyChecker,
        limits: Limits | None = None,
    ) -> None:
        self._matcher = matcher
        self._recipes = recipes
        self._pantry = pantry
        self._writer = writer
        self._embedder = embedder
        self._reranker = reranker
        self._checker = checker
        self._limits = limits or Limits()

    async def plan(self, inputs: PlanInputs) -> PlanResult:
        """Raises PlannerUnavailable if the recipes, the embedding model or Jev
        can't be reached. The query model and the reranker are not needed:
        without them the result is plainer, and says so."""
        household = resolve_household(
            self._matcher, inputs.common_allergens, inputs.custom_allergens
        )
        rules, _ = split_styles(inputs.diet_styles)
        result = PlanResult(warnings=[rule.caveat for rule in rules if rule.caveat])
        # A long plan needs more than the usual number, with a few to swap in.
        keep = max(self._limits.keep, inputs.plan_days + 3)
        try:
            pantry = await self._pantry()
            # The searches run side by side: they are the slow part.
            ranked = await asyncio.gather(
                *(
                    self._candidates(meal_type, inputs, household, rules, pantry, keep, result)
                    for meal_type in inputs.meal_types
                )
            )
            # The checks run one meal type after another, so a recipe two meal
            # types found goes to the first, and the second checks further down
            # its own list instead of coming up short.
            taken: set[int] = set()
            for meal_type, recipes in zip(inputs.meal_types, ranked, strict=True):
                fresh = [recipe for recipe in recipes if recipe.id not in taken]
                safe = await self._check(meal_type, fresh, household, rules, keep)
                taken.update(meal.recipe.id for meal in safe)
                result.meals[meal_type] = safe
                if len(safe) < inputs.plan_days:
                    result.warnings.append(
                        f"Only {len(safe)} {meal_type} recipes fit this household's rules, "
                        f"for a {inputs.plan_days}-day plan."
                    )
        except (RecipesUnavailable, EmbedderError, JudgeUnavailable) as exc:
            raise PlannerUnavailable(str(exc)) from exc
        return result

    async def _candidates(
        self,
        meal_type: MealType,
        inputs: PlanInputs,
        household: Household,
        rules: list[DietRule],
        pantry: Pantry,
        keep: int,
        result: PlanResult,
    ) -> list[RecipeCard]:
        """The recipes to consider for one meal type, best first. All of them
        passed the search filter. None has been through the safety check."""
        limits = self._limits
        wanted = max(limits.candidates, 3 * keep)
        started = time.monotonic()
        query = await self._writer.write(meal_type, inputs, limits.ideas)
        written = time.monotonic()
        if query.source == "template":
            result.warnings.append(
                f"No query model answered, so the {meal_type} suggestions come from a basic "
                "search. They keep to your rules but follow your tastes less closely."
            )
        served = [
            int(meal.recipe_id) for meal in inputs.recently_served if meal.recipe_id.isdigit()
        ]
        search_filter = pantry.filter(
            meal_type,
            household=household,
            rules=rules,
            served=served,
            low_carb_share=limits.low_carb_share,
        )
        vectors = await self._embedder.embed(query.ideas)
        embedded = time.monotonic()
        per_idea = -(-wanted // max(len(vectors), 1)) + 5
        found = await self._recipes.search(vectors, filter=search_filter, limit=per_idea)
        candidates = _interleave(found)[:wanted]
        # The embedding step is the one to watch: Bedrock throttles it.
        logger.info(
            "%s: %d searches written in %.1fs (%s), embedded in %.1fs, %d recipes found in %.1fs",
            meal_type,
            len(query.ideas),
            written - started,
            query.source,
            embedded - written,
            len(candidates),
            time.monotonic() - embedded,
        )
        if not candidates:
            return []
        try:
            order = await self._reranker.rerank(
                query.rerank_query, [describe(recipe) for recipe in candidates]
            )
        except Exception:
            # The search order is still a fair order, and the safety check
            # doesn't depend on it.
            logger.exception("Reranker failed for %s", meal_type)
            result.warnings.append(f"The {meal_type} suggestions could not be reranked.")
            order = []
        return [candidates[i] for i in _in_order(order, len(candidates))]

    async def _check(
        self,
        meal_type: MealType,
        ranked: list[RecipeCard],
        household: Household,
        rules: list[DietRule],
        keep: int,
    ) -> list[Checked]:
        """The first `keep` recipes that pass the safety check, going down the
        list a batch at a time until there are enough."""
        safe: list[Checked] = []
        unanswered = 0
        for batch in batched(ranked, self._limits.batch):
            verdicts = await asyncio.gather(
                *(self._checker.check(recipe, household, rules) for recipe in batch),
                return_exceptions=True,
            )
            for recipe, verdict in zip(batch, verdicts, strict=True):
                if isinstance(verdict, JudgeUnavailable):
                    # Not checked means not safe.
                    unanswered += 1
                elif isinstance(verdict, BaseException):
                    raise verdict
                elif verdict.safe:
                    safe.append(Checked(recipe, verdict.compliance))
            if unanswered == len(batch) and not safe:
                raise JudgeUnavailable("The allergen check could not be reached")
            if len(safe) >= keep:
                break
        if unanswered:
            logger.warning("%d %s recipes went unchecked and were left out", unanswered, meal_type)
        return safe[:keep]
