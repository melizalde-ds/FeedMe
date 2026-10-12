"""Turns a household's allergies into allergen groups of the reference file, and
decides which of the matcher's hits rule a food out for that household."""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from api.allergens.matcher import TIER_RANK, AllergenMatcher, Hit, tokens

Scope = tuple[str, ...] | None

# public.allergens.id -> groups of the reference file. A scope limits the gluten
# cereals to one of them. Shellfish is both groups: stricter is safer.
COMMON: dict[str, dict[str, Scope]] = {
    "milk": {"milk": None},
    "egg": {"egg": None},
    "peanut": {"peanut": None},
    "tree_nut": {"tree_nuts": None},
    "wheat": {"gluten_cereals": ("wheat",)},
    "gluten": {"gluten_cereals": None},
    "soy": {"soy": None},
    "fish": {"fish": None},
    "shellfish": {"crustaceans": None, "molluscs": None},
    "sesame": {"sesame": None},
}

# Every tier but "broad_category", which names whole kinds of food ("sauce",
# "soup") and would rule out most recipes. Used on ingredient names.
STRICT = frozenset(TIER_RANK) - {"broad_category"}
# Only what names the allergen itself. Used on cooking steps, where the weaker
# tiers are mostly verbs and cookware ("roll", "glaze", "cake pan").
DEFINITE = frozenset({"declared", "contains"})


@dataclass(frozen=True)
class Household:
    """What a household must avoid. Empty means no allergies."""

    # Group of the reference file -> scope. None is the whole group.
    groups: dict[str, Scope] = field(default_factory=dict)
    # Allergens the reference file has no group for, as normalized terms.
    custom: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.groups or self.custom)


def _merge(groups: dict[str, Scope], group: str, scope: Scope) -> None:
    if group not in groups:
        groups[group] = scope
    elif scope is None or groups[group] is None:
        groups[group] = None
    else:
        groups[group] = tuple(sorted(set(groups[group]) | set(scope)))


def resolve_household(
    matcher: AllergenMatcher, common: Iterable[str], custom: Iterable[str]
) -> Household:
    """`common` are ids from public.allergens, `custom` the user's own terms.
    A custom term that names a group ("mustard", "celery") becomes that group."""
    groups: dict[str, Scope] = {}
    terms: list[str] = []
    names = list(custom)
    for allergen_id in common:
        if allergen_id in COMMON:
            for group, scope in COMMON[allergen_id].items():
                _merge(groups, group, scope)
        else:
            # An id added to the table after this code: treat it as typed text.
            names.append(allergen_id.replace("_", " "))
    for name in names:
        found = matcher.resolve_profile([name])[0]["groups"]
        for group, info in found.items():
            scope = info["scope"]
            _merge(groups, group, None if scope is None else tuple(scope))
        term = " ".join(tokens(name))
        if not found and term:
            terms.append(term)
    return Household(groups, tuple(sorted(set(terms))))


def blocking_hits(
    hits: Iterable[Hit], household: Household, tiers: frozenset[str] = STRICT
) -> list[dict[str, Any]]:
    """The hits that rule a food out for this household.

    Each hit is judged on its own. The matcher's own `decide` works from a
    summary per group that drops weaker hits, so a wheat-only household could
    miss "flour" in a recipe that also has barley."""
    blocking = []
    for hit in hits:
        if hit.group not in household.groups:
            continue
        scope = household.groups[hit.group]
        tier = hit.tier
        if scope:
            if hit.subgroup and hit.subgroup not in scope:
                continue
            if not hit.subgroup and TIER_RANK[tier] > TIER_RANK["check_label"]:
                # Doesn't say which cereal, so it may be the one avoided.
                tier = "check_label"
        if tier in tiers:
            blocking.append(hit.as_dict() | {"tier": tier})
    return blocking


def custom_matches(text: str, household: Household) -> list[str]:
    """The household's custom allergens named in `text`.

    A term matches as whole words, and a word of four letters or more also
    matches inside a longer word ("corn" in "cornstarch"). That over-matches
    ("peppercorn"), which is the safe way to be wrong."""
    words = tokens(text)
    found = []
    for term in household.custom:
        parts = term.split()
        whole = any(words[i : i + len(parts)] == parts for i in range(len(words) - len(parts) + 1))
        inside = len(parts) == 1 and len(term) >= 4 and any(term in word for word in words)
        if whole or inside:
            found.append(term)
    return found
