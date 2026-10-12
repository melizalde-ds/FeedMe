"""Reads recipes from Qdrant, where scripts/ingest_recipes.py loads them."""

from collections.abc import Iterable
from typing import Any

import httpx
from pydantic import BaseModel, field_validator

# The parts of a recipe the buying agent uses.
_FIELDS = ["name", "ingredients", "servings", "image_url"]


class RecipesUnavailable(Exception):
    """Qdrant can't be reached, or has no recipes collection."""


class RecipeNotFound(Exception):
    def __init__(self, ids: list[int]) -> None:
        super().__init__(f"No recipe with id {', '.join(map(str, ids))}")
        self.ids = ids


class Recipe(BaseModel):
    id: int
    name: str
    # One normalized name per ingredient, such as 'chicken breast'. The amounts
    # are left in Qdrant: they have no units, and over a quarter of the recipes
    # have a different number of amounts than names.
    ingredients: list[str] = []
    servings: int | None = None
    image_url: str | None = None


class RecipeCard(Recipe):
    """A recipe with what the meal planner searches, checks and shows."""

    category: str | None = None
    keywords: list[str] = []
    # The ingredient names as the recipe wrote them, such as 'blueberries'.
    ingredients_raw: list[str] = []
    instructions: list[str] = []
    description: str | None = None
    total_min: int | None = None
    # Per serving.
    calories: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    fiber_g: float | None = None
    sodium_mg: float | None = None

    @field_validator("keywords", "ingredients", "ingredients_raw", "instructions", mode="before")
    @classmethod
    def _no_list_is_empty(cls, value: Any) -> Any:
        return [] if value is None else value


_CARD_FIELDS = [name for name in RecipeCard.model_fields if name != "id"]


class RecipeClient:
    def __init__(self, http: httpx.AsyncClient, collection: str) -> None:
        # http must be created with base_url set to Qdrant.
        self._http = http
        self._collection = collection

    async def _post(self, path: str, body: dict[str, Any]) -> Any:
        try:
            response = await self._http.post(f"/collections/{self._collection}/{path}", json=body)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise RecipesUnavailable(f"The recipes could not be read: {exc}") from exc
        return response.json()["result"]

    async def _points(self, ids: Iterable[int], fields: list[str]) -> dict[int, dict[str, Any]]:
        wanted = sorted(set(ids))
        result = await self._post("points", {"ids": wanted, "with_payload": fields})
        found = {point["id"]: point["payload"] for point in result}
        if missing := [recipe_id for recipe_id in wanted if recipe_id not in found]:
            raise RecipeNotFound(missing)
        return found

    async def get(self, ids: Iterable[int]) -> dict[int, Recipe]:
        """The recipes with these ids, by id. Raises RecipeNotFound if any is missing."""
        found = await self._points(ids, _FIELDS)
        return {recipe_id: Recipe(id=recipe_id, **payload) for recipe_id, payload in found.items()}

    async def cards(self, ids: Iterable[int]) -> dict[int, RecipeCard]:
        """Like `get`, with everything the meal planner shows."""
        found = await self._points(ids, _CARD_FIELDS)
        return {
            recipe_id: RecipeCard(id=recipe_id, **payload) for recipe_id, payload in found.items()
        }

    async def ingredient_names(self) -> list[str]:
        """Every distinct normalized ingredient name the recipes use."""
        # A few thousand at most. The limit is far above that on purpose.
        result = await self._post("facet", {"key": "ingredients", "limit": 100_000, "exact": True})
        return [hit["value"] for hit in result["hits"]]

    async def search(
        self, vectors: list[list[float]], *, filter: dict[str, Any], limit: int
    ) -> list[list[RecipeCard]]:
        """The closest recipes to each vector that pass the filter, best first.
        `filter` is a Qdrant filter. One list per vector, in the same order."""
        if not vectors:
            return []
        searches = [
            {"query": vector, "filter": filter, "limit": limit, "with_payload": _CARD_FIELDS}
            for vector in vectors
        ]
        result = await self._post("points/query/batch", {"searches": searches})
        return [
            [RecipeCard(id=point["id"], **point["payload"]) for point in found["points"]]
            for found in result
        ]
