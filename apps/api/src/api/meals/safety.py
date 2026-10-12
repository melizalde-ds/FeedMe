"""The last check on a recipe before it can be suggested.

The search filter only reads the normalized ingredient names. This check reads
the whole recipe twice: once with the reference files, and once with Jev, which
knows that "cool whip" has milk in it where a word list may not. Either can
rule the recipe out, and a recipe Jev couldn't be asked about is ruled out."""

import logging
from dataclasses import dataclass
from typing import Any, Protocol

from typesafe_sdk import AsyncTypeSafeClient, TypeSafeError

from api.allergens.matcher import AllergenMatcher, Hit
from api.allergens.profile import DEFINITE, STRICT, Household, blocking_hits, custom_matches
from api.meals.diets import DietBook, DietRule
from api.recipes.client import RecipeCard

logger = logging.getLogger(__name__)


class JudgeUnavailable(Exception):
    """Jev could not be asked, so nothing can be called safe."""


class Judge(Protocol):
    async def ask(self, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, float]:
        """The probability of "yes" for each yes/no question about `state`.
        Raises JudgeUnavailable if any question went unanswered."""
        ...


class JevJudge:
    """TypeSafe's Jev model. It answers yes/no questions with a probability."""

    def __init__(self, client: AsyncTypeSafeClient, model: str) -> None:
        self._client = client
        # Saved with each meal option, to know which model called it safe.
        self.model = model

    async def ask(self, state: dict[str, Any], questions: dict[str, Any]) -> dict[str, float]:
        try:
            response = await self._client.system_one(
                state=state, questions=questions, model=self.model
            )
        except (TypeSafeError, OSError) as exc:
            raise JudgeUnavailable(f"The allergen check could not be reached: {exc}") from exc
        answers = {name: answer.noul for name, answer in response.nouls.items()}
        if answers.keys() != questions.keys():
            raise JudgeUnavailable("The allergen check left a question unanswered")
        return answers


# What Jev is asked to look for, per allergen group of the reference file.
_AVOID = {
    "milk": "milk or any dairy product from any animal, such as butter, cheese, cream, yogurt, "
    "whey or casein",
    "egg": "eggs or anything made with egg, such as mayonnaise, meringue or egg noodles",
    "peanut": "peanuts or anything made from peanuts, such as peanut butter or peanut oil",
    "tree_nuts": "tree nuts such as almonds, walnuts, pecans, cashews, pistachios, hazelnuts "
    "or pine nuts, or anything made from them",
    "fish": "fish or anything made from fish, such as anchovies, fish sauce or "
    "Worcestershire sauce",
    "crustaceans": "crustaceans such as shrimp, prawns, crab, lobster or crayfish",
    "molluscs": "molluscs such as clams, mussels, oysters, scallops, squid or octopus",
    "gluten_cereals": "wheat, barley, rye or oats, or anything made from them, such as flour, "
    "bread, pasta, couscous, soy sauce or beer",
    "soy": "soy or anything made from soy, such as tofu, soy sauce, miso, edamame or soy milk",
    "sesame": "sesame seeds or anything made from them, such as tahini or sesame oil",
    "mustard": "mustard seed, mustard powder or prepared mustard",
    "celery": "celery, celeriac, celery seed or celery salt",
    "lupin": "lupin beans or lupin flour",
    "sulphites": "sulphites, such as in wine, dried fruit or vinegar",
}
_WHEAT_ONLY = (
    "wheat or anything made from wheat, such as flour, bread, pasta, couscous, semolina "
    "or soy sauce"
)


def _question(avoid: str) -> dict[str, Any]:
    # Jev reads a question literally, so it says what counts in so many words.
    return {
        "type": "noul",
        "instructions": f"Is this recipe unsafe for someone who must avoid {avoid}? It is "
        "unsafe if any ingredient in `recipe.ingredients` or any step in `recipe.steps` uses "
        "it, a food made from it, or a brand-name or ready-made product that is normally "
        "made with it. `reference_notes` lists words in the recipe that an allergen "
        "reference says may mean it.",
        "criteria": {
            "true": "Unsafe: something in the recipe is it, is made from it, or normally has "
            "it as an ingredient.",
            "false": "Safe: nothing in the recipe is it, is made from it, or normally has it "
            "as an ingredient.",
        },
    }


def _both_question(first: str, second: str) -> dict[str, Any]:
    return {
        "type": "noul",
        "instructions": f"Does this recipe use both of these: (1) {first}, and (2) {second}? "
        "Look at `recipe.ingredients` and `recipe.steps`. Answer no if it uses only one of "
        "the two, or neither.",
        "criteria": {
            "true": "The recipe uses at least one food of the first kind and at least one of "
            "the second kind.",
            "false": "The recipe uses foods of only one of the two kinds, or of neither.",
        },
    }


@dataclass(frozen=True)
class Verdict:
    safe: bool
    # Stored with the meal option when safe; the reasons when not.
    compliance: dict[str, Any]


class SafetyChecker:
    def __init__(
        self,
        matcher: AllergenMatcher,
        book: DietBook,
        judge: Judge,
        *,
        allergen_threshold: float,
        diet_threshold: float,
    ) -> None:
        self._matcher = matcher
        self._book = book
        self._judge = judge
        # A recipe is dropped at or above these probabilities. The allergen one
        # is low on purpose: a doubt is enough.
        self._allergen_threshold = allergen_threshold
        self._diet_threshold = diet_threshold

    def _read(self, recipe: RecipeCard, household: Household) -> tuple[list[dict], list[dict]]:
        """What the reference file finds: the hits that rule the recipe out, and
        the weaker ones Jev should know about."""
        blocking: list[dict[str, Any]] = []
        notes: list[dict[str, Any]] = []

        def take(text: str, tiers: frozenset[str], where: str) -> None:
            hits: list[Hit] = self._matcher.match_item(text)[0]
            found = blocking_hits(hits, household, tiers)
            blocking.extend(hit | {"where": where} for hit in found)
            blocking.extend(
                {"group": "custom", "phrase": term, "item": text, "where": where}
                for term in custom_matches(text, household)
            )
            ruled_out = {(hit["group"], hit["phrase"]) for hit in found}
            # "broad_category" hits ("sauce", "seasoning") are left out here as
            # they are everywhere else: told about them, Jev doubts every recipe.
            notes.extend(
                {"word": hit.phrase, "in": hit.item, "may_mean": hit.group}
                for hit in hits
                if hit.group in household.groups
                and hit.tier in STRICT
                and (hit.group, hit.phrase) not in ruled_out
            )

        for name in dict.fromkeys(recipe.ingredients + recipe.ingredients_raw):
            take(name, STRICT, "ingredient")
        for step in recipe.instructions:
            # Cooking steps are full of words that only look like food.
            take(step, DEFINITE, "step")
        return blocking, notes

    def _questions(self, household: Household, rules: list[DietRule]) -> dict[str, Any]:
        questions = {}
        for group, scope in household.groups.items():
            avoid = (
                _WHEAT_ONLY if group == "gluten_cereals" and scope == ("wheat",) else _AVOID[group]
            )
            questions[f"allergen:{group}"] = _question(avoid)
        for term in household.custom:
            questions[f"allergen:{term}"] = _question(f"{term}, or anything made from it")
        for rule in rules:
            asks = [_question(avoid) for avoid in rule.avoids]
            asks += [_both_question(first, second) for first, second in rule.both]
            for number, ask in enumerate(asks, start=1):
                # "diet:vegetarian", or "diet:kosher 2" when a diet asks several.
                name = f"diet:{rule.style}" + (f" {number}" if len(asks) > 1 else "")
                questions[name] = ask
        return questions

    async def check(
        self, recipe: RecipeCard, household: Household, rules: list[DietRule]
    ) -> Verdict:
        """Raises JudgeUnavailable if Jev was needed and didn't answer."""
        blocking, notes = self._read(recipe, household)
        names = list(dict.fromkeys(recipe.ingredients + recipe.ingredients_raw))
        diets_broken = {
            rule.style: broken for rule in rules if (broken := self._book.broken(rule, names))
        }
        if blocking or diets_broken:
            return Verdict(False, {"reference": blocking, "diets_broken": diets_broken})

        questions = self._questions(household, rules)
        compliance: dict[str, Any] = {
            "reference": {
                "version": self._matcher.lex["meta"]["version"],
                "result": "pass",
                "notes": notes,
            },
            "checks": {},
        }
        if not questions:
            # No allergies and no diet to keep: nothing to ask.
            return Verdict(True, compliance)

        state = {
            "recipe": {
                "name": recipe.name,
                "ingredients": recipe.ingredients_raw or recipe.ingredients,
                "steps": recipe.instructions,
            },
            "reference_notes": notes,
        }
        answers = await self._judge.ask(state, questions)
        safe = True
        for name, probability in answers.items():
            limit = self._diet_threshold if name.startswith("diet:") else self._allergen_threshold
            passed = probability < limit
            safe = safe and passed
            compliance["checks"][name] = {
                "pass": passed,
                "probability": round(probability, 4),
                "limit": limit,
            }
        compliance["model"] = getattr(self._judge, "model", None)
        return Verdict(safe, compliance)
