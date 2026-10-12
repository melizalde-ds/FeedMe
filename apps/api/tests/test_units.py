import pytest

from api.shopping.units import packs_needed, unit_price


@pytest.mark.parametrize(
    ("quantity", "unit", "size", "size_unit", "packs"),
    [
        (8, "whole", 12, "count", 1),
        (14, "whole", 12, "count", 2),
        (12, "ct", 12, "count", 1),
        (24, "oz", 1.5, "lb", 1),
        (25, "oz", 1.5, "lb", 2),
        (500, "g", 16, "oz", 2),
        (4, "cups", 64, "fl oz", 1),
        (9, "cup", 64, "fl oz", 2),
        (6, "tbsp", 16.9, "fl oz", 1),
        (2, "Tablespoons", 0.5, "fl oz", 2),
        # Can't be compared, so one pack.
        (40, "cup", 42, "oz", 1),
        (6, "clove", 3, "count", 1),
        (2, "can", 15, "oz", 1),
        (3, "", 12, "count", 1),
    ],
)
def test_packs_needed(quantity, unit, size, size_unit, packs):
    assert packs_needed(quantity, unit, size, size_unit) == packs


def test_unit_price_uses_one_base_unit_per_dimension():
    assert unit_price(399, 1.5, "lb") == (16.62, "oz")
    assert unit_price(289, 12, "count") == (24.08, "count")
    assert unit_price(348, 128, "fl oz") == (2.72, "fl oz")
