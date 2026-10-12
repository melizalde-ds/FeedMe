import pytest
from conftest import listing, make_index, store

from api.shopping.errors import ShoppingError
from api.shopping.schemas import ListItem, Pick
from api.shopping.service import ShoppingList, compare_prices, plan_basket


def shopping_list(*names, quantity=1, unit="count"):
    return ShoppingList([ListItem(name=n, quantity=quantity, unit=unit) for n in names])


def lines(option):
    return {line.ingredient: (line.store, line.upc, line.packs) for line in option.lines}


def test_split_beats_the_best_single_store():
    index = make_index(
        [store("a"), store("b")],
        [
            listing("a", "1", "milk", 300),
            listing("b", "1", "milk", 350),
            listing("a", "2", "eggs", 400),
            listing("b", "2", "eggs", 250),
        ],
    )
    plan = plan_basket(
        index,
        [Pick(ingredient="milk", upc="1"), Pick(ingredient="eggs", upc="2")],
        shopping_list("milk", "eggs"),
    )
    assert lines(plan.cheapest) == {"milk": ("a", "1", 1), "eggs": ("b", "2", 1)}
    assert plan.cheapest.total_cents == 550
    assert [t.store for t in plan.best_single_store.stores] == ["b"]
    assert plan.best_single_store.total_cents == 600
    assert plan.savings_cents == 50


def test_a_delivery_fee_is_only_paid_when_it_is_worth_it():
    stores = [store("a"), store("b", fee=599)]
    cheap_at_b = [listing("a", "1", "milk", 300), listing("b", "1", "milk", 200)]
    plan = plan_basket(
        make_index(stores, cheap_at_b), [Pick(ingredient="milk", upc="1")], shopping_list("milk")
    )
    assert lines(plan.cheapest) == {"milk": ("a", "1", 1)}

    much_cheaper = [listing("a", "1", "milk", 1500), listing("b", "1", "milk", 200)]
    plan = plan_basket(
        make_index(stores, much_cheaper), [Pick(ingredient="milk", upc="1")], shopping_list("milk")
    )
    assert lines(plan.cheapest) == {"milk": ("b", "1", 1)}
    assert plan.cheapest.stores[0].delivery_fee_cents == 599
    assert plan.cheapest.total_cents == 799


def test_free_delivery_threshold_waives_the_fee():
    index = make_index(
        [store("b", fee=599, free_over=1000)], [listing("b", "1", "milk", 1000)]
    )
    plan = plan_basket(index, [Pick(ingredient="milk", upc="1")], shopping_list("milk"))
    assert plan.cheapest.stores[0].delivery_fee_cents == 0


def test_order_minimum_keeps_a_store_out_until_the_basket_reaches_it():
    stores = [store("a"), store("club", minimum=5000)]
    listings = [
        listing("a", "1", "rice", 400, size=(5, "lb")),
        listing("club", "9", "rice", 1200, size=(20, "lb")),
    ]
    index = make_index(stores, listings)
    pick = [Pick(ingredient="rice", upc="1")]

    # 20 lb: one club pack at $12 beats 4 packs at a for $16, but is under the minimum.
    small = plan_basket(index, pick, shopping_list("rice", quantity=20, unit="lb"))
    assert lines(small.cheapest) == {"rice": ("a", "1", 4)}

    # 100 lb: 20 packs at a = $80, 5 club packs = $60, which clears the $50 minimum.
    large = plan_basket(index, pick, shopping_list("rice", quantity=100, unit="lb"))
    assert lines(large.cheapest) == {"rice": ("club", "9", 5)}
    assert large.cheapest.lines[0].match == "comparable"


def test_out_of_stock_is_skipped_and_flagged():
    index = make_index(
        [store("a"), store("b")],
        [listing("a", "1", "milk", 300, in_stock=False), listing("b", "1", "milk", 350)],
    )
    plan = plan_basket(index, [Pick(ingredient="milk", upc="1")], shopping_list("milk"))
    (line,) = plan.cheapest.lines
    assert (line.store, line.replaces_out_of_stock) == ("b", True)


def test_store_brand_is_comparable_not_exact():
    index = make_index(
        [store("a"), store("b")],
        [listing("a", "1", "milk", 300), listing("b", "7", "milk", 250, store_brand=True)],
    )
    plan = plan_basket(index, [Pick(ingredient="milk", upc="1")], shopping_list("milk"))
    (line,) = plan.cheapest.lines
    assert (line.upc, line.match, line.store_brand) == ("7", "comparable", True)


def test_nothing_in_stock_is_reported_as_missing():
    index = make_index(
        [store("a")],
        [listing("a", "1", "milk", 300), listing("a", "2", "eggs", 250, in_stock=False)],
    )
    plan = plan_basket(
        index,
        [Pick(ingredient="milk", upc="1"), Pick(ingredient="eggs", upc="2")],
        shopping_list("milk", "eggs"),
    )
    assert plan.cheapest.missing == ["eggs"]
    assert lines(plan.cheapest) == {"milk": ("a", "1", 1)}


def test_savings_are_not_reported_when_one_store_cannot_cover_the_list():
    index = make_index(
        [store("a"), store("b")],
        [listing("a", "1", "milk", 300), listing("b", "2", "eggs", 250)],
    )
    plan = plan_basket(
        index,
        [Pick(ingredient="milk", upc="1"), Pick(ingredient="eggs", upc="2")],
        shopping_list("milk", "eggs"),
    )
    assert plan.cheapest.missing == []
    assert len(plan.best_single_store.missing) == 1
    assert plan.savings_cents is None


def test_bad_picks_are_errors_the_agent_can_read():
    index = make_index([store("a")], [listing("a", "1", "milk", 300)])
    with pytest.raises(ShoppingError, match="not on the shopping list"):
        plan_basket(index, [Pick(ingredient="caviar", upc="1")], shopping_list("milk"))
    with pytest.raises(ShoppingError, match="No store sells"):
        plan_basket(index, [Pick(ingredient="milk", upc="999")], shopping_list("milk"))


def test_compare_prices_ranks_by_price_per_unit():
    index = make_index(
        [store("a"), store("b"), store("club")],
        [
            listing("a", "1", "eggs", 289, size=(12, "count")),
            listing("b", "1", "eggs", 312, size=(12, "count")),
            listing("club", "9", "eggs", 650, size=(36, "count")),
        ],
    )
    rows = compare_prices(index, "1")
    assert [(r.store, r.match, r.unit_price_cents) for r in rows] == [
        ("club", "comparable", 18.06),
        ("a", "exact", 24.08),
        ("b", "exact", 26.0),
    ]
