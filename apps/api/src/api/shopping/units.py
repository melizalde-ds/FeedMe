"""Unit conversion for working out how many packs cover a recipe amount."""

import math

# Each unit as a multiple of its dimension's base unit: oz, fl oz or count.
_WEIGHT = {"oz": 1.0, "lb": 16.0, "g": 0.035274, "kg": 35.274}
_VOLUME = {
    "fl oz": 1.0,
    "tsp": 1 / 6,
    "tbsp": 0.5,
    "cup": 8.0,
    "pt": 16.0,
    "qt": 32.0,
    "gal": 128.0,
    "ml": 0.033814,
    "l": 33.814,
}
_COUNT = {"count": 1.0}
_DIMENSIONS = {"oz": _WEIGHT, "fl oz": _VOLUME, "count": _COUNT}

_ALIASES = {
    "ounce": "oz",
    "pound": "lb",
    "lbs": "lb",
    "gram": "g",
    "kilogram": "kg",
    "fluid ounce": "fl oz",
    "floz": "fl oz",
    "teaspoon": "tsp",
    "tablespoon": "tbsp",
    "pint": "pt",
    "quart": "qt",
    "gallon": "gal",
    "milliliter": "ml",
    "liter": "l",
    "ct": "count",
    "whole": "count",
    "each": "count",
    "piece": "count",
}


def _base(quantity: float, unit: str) -> tuple[float, str] | None:
    """The amount in its dimension's base unit, or None for a unit we can't convert."""
    unit = unit.strip().lower().rstrip(".")
    for name in (unit, unit.removesuffix("s")):
        name = _ALIASES.get(name, name)
        for base_unit, table in _DIMENSIONS.items():
            if name in table:
                return quantity * table[name], base_unit
    return None


def packs_needed(quantity: float, unit: str, size_value: float, size_unit: str) -> int:
    """Packs that cover the amount. One pack when the units can't be compared,
    such as "2 cloves" of garlic or cups of something sold by weight."""
    need = _base(quantity, unit)
    pack = _base(size_value, size_unit)
    if need is None or pack is None or need[1] != pack[1]:
        return 1
    return max(1, math.ceil(need[0] / pack[0] - 1e-9))


def unit_price(price_cents: int, size_value: float, size_unit: str) -> tuple[float, str]:
    """Price in cents per oz, fl oz or count."""
    pack = _base(size_value, size_unit)
    if pack is None:
        return float(price_cents), "pack"
    return round(price_cents / pack[0], 2), pack[1]
