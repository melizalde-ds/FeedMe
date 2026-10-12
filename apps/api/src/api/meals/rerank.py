"""Reorders the search results by how well they fit the household.

The real reranker plugs in here: write a class with this `rerank` method and
return it from `get_reranker` in api.meals.router."""

from typing import Protocol


class Reranker(Protocol):
    async def rerank(self, query: str, documents: list[str]) -> list[int]:
        """The positions of `documents` from best to worst fit for `query`.

        `query` is one or two sentences on what the household wants for this
        meal. Each document is a recipe as a line of text. Positions left out
        are kept after the ones returned, in their original order."""
        ...


class PassThroughReranker:
    """Keeps the order of the search. Stands in until a reranker is set."""

    async def rerank(self, query: str, documents: list[str]) -> list[int]:
        return list(range(len(documents)))
