"""Every ingredient name the recipes use, run through the matcher once.

Qdrant can only match an ingredient name exactly, and the recipes say "vanilla
yogurt" where the reference file says "yogurt". So the matcher reads each name
that occurs, and a household's search filter is the list of names it rules out."""

from collections.abc import Iterable

from api.allergens.matcher import AllergenMatcher, Hit
from api.allergens.profile import STRICT, Household, blocking_hits, custom_matches


class IngredientVocabulary:
    def __init__(self, matcher: AllergenMatcher, names: Iterable[str]) -> None:
        self._hits: dict[str, list[Hit]] = {name: matcher.match_item(name)[0] for name in names}

    @property
    def names(self) -> list[str]:
        return list(self._hits)

    def hits(self, name: str) -> list[Hit]:
        return self._hits.get(name, [])

    def blocked(self, household: Household, tiers: frozenset[str] = STRICT) -> list[str]:
        """The ingredient names this household can't have, sorted."""
        if not household:
            return []
        return sorted(
            name
            for name, hits in self._hits.items()
            if blocking_hits(hits, household, tiers) or custom_matches(name, household)
        )
