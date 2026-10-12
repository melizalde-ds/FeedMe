import pytest
from conftest import listing, make_index, store

from api.cart.service import AddLine, CartService
from api.cart.store import InMemoryCartStore
from api.shopping.errors import ShoppingError
from api.shopping.schemas import ListItem
from api.shopping.service import ShoppingList

pytestmark = pytest.mark.anyio

STORES = [store("a"), store("b", fee=599)]
LISTINGS = [
    listing("a", "1", "milk", 300, size=(64, "fl oz")),
    listing("a", "2", "eggs", 289, size=(12, "count")),
    listing("a", "3", "eggs", 250, size=(12, "count"), store_brand=True),
    listing("a", "4", "rice", 400, size=(1, "lb")),
    listing("a", "5", "salmon", 900, in_stock=False),
    listing("b", "5", "salmon", 1000),
    listing("a", "6", "beans", 100, in_stock=False),
    listing("a", "7", "chili-powder", 199, name="Chili Powder"),
]
NEEDS = [
    ListItem(name="Milk", quantity=3, unit="cup"),
    ListItem(name="Eggs", quantity=14, unit="whole"),
    ListItem(name="Rice", quantity=11, unit="lb"),
    ListItem(name="Salmon", quantity=1, unit="count"),
    ListItem(name="Beans", quantity=1, unit="count"),
    ListItem(name="Red pepper flakes", quantity=1, unit="tsp"),
]


def cart(mode, budget_cents=20_000, store=None):
    return CartService(
        store or InMemoryCartStore(),
        make_index(STORES, LISTINGS),
        ShoppingList(NEEDS),
        mode,
        budget_cents,
    )


def line(ingredient, upc, store="a", sure=True):
    return AddLine(ingredient=ingredient, store=store, upc=upc, sure=sure)


async def test_manual_mode_proposes_everything():
    item = await cart("manual").add(line("milk", "1"))
    assert (item.status, item.hold_reasons) == ("proposed", [])


async def test_auto_mode_adds_a_clean_item_straight_to_the_cart():
    item = await cart("auto").add(line("milk", "1"))
    assert (item.status, item.hold_reasons) == ("in_cart", [])


async def test_auto_without_a_budget_falls_back_to_manual():
    item = await cart("auto", budget_cents=None).add(line("milk", "1"))
    assert item.status == "proposed"


async def test_price_and_pack_count_come_from_the_server():
    item = await cart("auto").add(line("eggs", "2"))
    # 14 eggs from 12-packs.
    assert (item.quantity, item.unit_price_cents, item.line_total_cents) == (2, 289, 578)
    assert item.for_ingredient == "Eggs"


@pytest.mark.parametrize(
    ("add", "reason"),
    [
        (line("eggs", "3"), "store_brand"),
        (line("salmon", "5", store="b"), "out_of_stock_replacement"),
        (line("milk", "1", sure=False), "unsure_match"),
        # The agent says it is sure, but no word of the item is in the product.
        (line("red pepper flakes", "7"), "unsure_match"),
        (line("rice", "4"), "large_quantity"),
    ],
)
async def test_auto_mode_holds_these_for_the_users_check(add, reason):
    item = await cart("auto").add(add)
    assert item.status == "proposed"
    assert item.hold_reasons == [reason]


async def test_auto_mode_holds_what_would_pass_the_budget():
    service = cart("auto", budget_cents=800)
    assert (await service.add(line("milk", "1"))).status == "in_cart"  # $3.00
    eggs = await service.add(line("eggs", "2"))  # + $5.78 = $8.78
    assert (eggs.status, eggs.hold_reasons) == ("proposed", ["over_budget"])
    view = await service.view()
    assert view.in_cart.total_cents == 300


async def test_delivery_fees_count_toward_the_budget():
    service = cart("auto", budget_cents=1500)
    salmon = await service.add(line("salmon", "5", store="b"))  # $10.00 + $5.99 fee
    assert "over_budget" in salmon.hold_reasons


async def test_everything_not_flagged_over_budget_fits_in_the_budget():
    service = cart("manual", budget_cents=800)
    await service.add(line("milk", "1"))
    await service.add(line("eggs", "2"))
    await service.add(line("red pepper flakes", "7"))  # still fits after the eggs didn't
    items = (await service.view()).items
    within = sum(i.line_total_cents for i in items if "over_budget" not in i.hold_reasons)
    assert within <= 800
    assert [i.for_ingredient for i in items if "over_budget" in i.hold_reasons] == ["Eggs"]


@pytest.mark.parametrize(
    ("add", "message"),
    [
        (line("beans", "6"), "out of stock"),
        (line("caviar", "1"), "not on the shopping list"),
        (line("milk", "999"), "does not sell"),
        (line("milk", "1", store="b"), "does not sell"),
    ],
)
async def test_bad_adds_are_rejected(add, message):
    service = cart("auto")
    with pytest.raises(ShoppingError, match=message):
        await service.add(add)
    assert (await service.view()).items == []


async def test_approving_moves_the_whole_proposed_basket_into_the_cart():
    store_ = InMemoryCartStore()
    service = cart("manual", store=store_)
    await service.add(line("milk", "1"))
    await service.add(line("salmon", "5", store="b"))
    await service.remove("a", "1")  # the user edits the basket first
    assert (await service.view()).in_cart.total_cents == 0

    assert await store_.approve_all() == 1
    view = await service.view()
    assert [(i.for_ingredient, i.status) for i in view.items] == [("Salmon", "in_cart")]
    assert view.in_cart.total_cents == 1599  # delivery fee included


async def test_removing_something_not_in_the_cart_is_an_error():
    with pytest.raises(ShoppingError, match="no item"):
        await cart("manual").remove("a", "1")
