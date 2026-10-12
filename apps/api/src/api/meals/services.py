"""What the meal planner keeps for the life of the app: the reference files, the
ingredient names read through them, and the clients for Jev and the embedder."""

import os
import time

import httpx
from typesafe_sdk import AsyncTypeSafeClient

from api.allergens import load_matcher
from api.meals.diets import DietBook
from api.meals.embed import Embedder, TitanEmbedder
from api.meals.pantry import Pantry
from api.meals.pipeline import PlannerUnavailable
from api.meals.safety import JevJudge, Judge
from api.recipes.client import RecipeClient
from api.settings import Settings

# How long the ingredient names are trusted before Qdrant is asked again, so
# newly loaded recipes get filtered too.
PANTRY_SECONDS = 600.0


class MealServices:
    def __init__(self, settings: Settings, recipes_http: httpx.AsyncClient) -> None:
        self._settings = settings
        self.matcher = load_matcher()
        self.book = DietBook(self.matcher)
        self.recipes = RecipeClient(recipes_http, settings.qdrant_collection)
        self._pantry: Pantry | None = None
        self._pantry_at = 0.0
        self._jev: AsyncTypeSafeClient | None = None
        self._embedder: Embedder | None = None

    async def pantry(self) -> Pantry:
        if self._pantry is None or time.monotonic() - self._pantry_at > PANTRY_SECONDS:
            names = await self.recipes.ingredient_names()
            self._pantry = Pantry(self.matcher, self.book, names)
            self._pantry_at = time.monotonic()
        return self._pantry

    def judge(self) -> Judge:
        settings = self._settings
        if not settings.jev_api:
            raise PlannerUnavailable(
                "Set JEV_API in .env: without the allergen check no meal can be suggested."
            )
        if self._jev is None:
            self._jev = AsyncTypeSafeClient(api_key=settings.jev_api)
        return JevJudge(self._jev, settings.jev_model)

    def embedder(self) -> Embedder:
        settings = self._settings
        if self._embedder is None:
            if settings.aws_bearer_token_bedrock:
                # The AWS SDK only reads a Bedrock API key from the environment.
                os.environ.setdefault("AWS_BEARER_TOKEN_BEDROCK", settings.aws_bearer_token_bedrock)
            try:
                self._embedder = TitanEmbedder(
                    settings.bedrock_embed_model_id, settings.embed_dimensions, settings.aws_region
                )
            except Exception as exc:
                raise PlannerUnavailable(str(exc)) from exc
        return self._embedder

    async def aclose(self) -> None:
        if self._jev is not None:
            await self._jev.aclose()
