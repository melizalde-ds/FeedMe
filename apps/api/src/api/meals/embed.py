"""Turns search text into vectors, with the model the recipes were embedded with."""

import asyncio
import json
from typing import Any, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

# Vectors kept in memory, about 8 kB each.
_REMEMBERED = 1000


class EmbedderError(Exception):
    """The embedding model could not be reached or is not configured."""


class Embedder(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """One vector per text, in the same order."""
        ...


class TitanEmbedder:
    """Titan Text Embeddings V2 on Bedrock, called the way scripts/ingest_recipes.py
    calls it. The model and the size must match what the recipes were loaded with,
    or the search compares unrelated numbers."""

    def __init__(
        self, model_id: str, dimensions: int, region: str | None = None, client: Any = None
    ) -> None:
        self._model_id = model_id
        self._dimensions = dimensions
        # Bedrock throttled this model to about 0.6 calls a second on our key
        # (measured 2026-10-10), and more calls at once only add retries.
        self._slots = asyncio.Semaphore(4)
        # The same text always gives the same vector, and the fixed searches
        # used without a query model repeat on every run.
        self._known: dict[str, list[float]] = {}
        try:
            self._client = client or boto3.client(
                "bedrock-runtime",
                region_name=region,
                # A plan embeds a dozen or more texts at once. Adaptive mode
                # slows down by itself when Bedrock throttles.
                config=Config(
                    retries={"max_attempts": 10, "mode": "adaptive"}, max_pool_connections=32
                ),
            )
        except BotoCoreError as exc:
            raise EmbedderError(f"Bedrock is not configured: {exc}") from exc

    def _one(self, text: str) -> list[float]:
        # Titan takes one text per call.
        body = {"inputText": text, "dimensions": self._dimensions, "normalize": True}
        response = self._client.invoke_model(modelId=self._model_id, body=json.dumps(body))
        return json.loads(response["body"].read())["embedding"]

    async def _cached(self, text: str) -> list[float]:
        if text not in self._known:
            async with self._slots:
                # boto3 is blocking, so keep it off the event loop.
                vector = await asyncio.to_thread(self._one, text)
            if len(self._known) >= _REMEMBERED:
                self._known.pop(next(iter(self._known)))
            self._known[text] = vector
        return self._known[text]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            return list(await asyncio.gather(*(self._cached(text) for text in texts)))
        except (BotoCoreError, ClientError) as exc:
            raise EmbedderError(f"The search text could not be embedded: {exc}") from exc
