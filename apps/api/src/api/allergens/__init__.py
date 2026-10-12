from pathlib import Path

from api.allergens.matcher import AllergenMatcher

_HERE = Path(__file__).parent


def load_matcher() -> AllergenMatcher:
    """The reference file, plus the terms this app adds to it."""
    return AllergenMatcher.load(_HERE / "allergen_reference.json", _HERE / "allergen_extras.json")
