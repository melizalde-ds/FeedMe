"""The buying agent's HTTP routes, with the Supabase side replaced by a fake.
test_supabase_live.py runs the same flow against the real local stack."""

import json
import time
from pathlib import Path

import httpx
import jwt
import pytest
from conftest import listing, make_index, store
from link_fakes import FakeLink, FakeStripe, storefront_app
from run_fakes import LIST_ID, MEALS, FakeShoppingData, grocery_items, qdrant, recipes_from

from api.agent.providers.scripted import ScriptedProvider
from api.auth import CurrentUser
from api.cart.service import AddLine, CartService
from api.cart.store import InMemoryCartStore
from api.main import create_app
from api.runs import router as runs
from api.runs import service
from api.runs.data import GroceryItem
from api.runs.service import shopping_items
from api.settings import Settings
from api.shopping.client import StorefrontClient
from api.shopping.schemas import ListItem
from api.shopping.service import ShoppingList
from api.wallet.link import LinkWallet

pytestmark = pytest.mark.anyio

SAMPLE = json.loads((Path(__file__).parent / "sample_list.json").read_text())
SECRET = "test-secret-" + "x" * 32
USER = "33333333-3333-4333-8333-333333333333"
RUNS = f"/api/grocery-lists/{LIST_ID}/shopping-runs"
RECIPE_RUNS = "/api/shopping-runs"
CART = f"/api/grocery-lists/{LIST_ID}/cart"
AUTO_BUY = "/api/auto-buy"


def token(secret=SECRET, **claims):
    payload = {"sub": USER, "aud": "authenticated", "exp": int(time.time()) + 600} | claims
    return jwt.encode(payload, secret, algorithm="HS256")


def events_of(response):
    """The JSON payload of each server-sent event, in order."""
    blocks = [block for block in response.text.split("\n\n") if block.startswith("event:")]
    return [json.loads(block.split("\ndata: ", 1)[1]) for block in blocks]


@pytest.fixture
def stripe():
    return FakeStripe()


@pytest.fixture
async def stores(stripe):
    """An HTTP client for a storefront that has sandbox keys and a fake Stripe."""
    transport = httpx.ASGITransport(app=storefront_app(stripe))
    async with httpx.AsyncClient(transport=transport, base_url="http://storefront") as client:
        yield client


@pytest.fixture
def data():
    return FakeShoppingData(grocery_items(SAMPLE))


@pytest.fixture
def app(data, stores):
    settings = Settings(
        _env_file=None,
        supabase_jwt_secret=SECRET,
        supabase_anon_key="anon",
        supabase_service_role_key="service",
    )
    app = create_app(settings)

    # Still asks for the signed-in user, so the real token check runs.
    def signed_in_data(user: CurrentUser):
        assert user.id == USER
        return data

    app.dependency_overrides |= {
        runs.get_shopping_data: signed_in_data,
        runs.get_storefront: lambda: StorefrontClient(stores),
        runs.get_recipes: recipes_from(qdrant),
        runs.get_model: ScriptedProvider,
        runs.get_wallet: lambda: None,
    }
    return app


@pytest.fixture
async def api(app):
    transport = httpx.ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {token()}"}
    async with httpx.AsyncClient(transport=transport, base_url="http://api", headers=headers) as c:
        yield c


def pay_with(app, stores):
    link = FakeLink(stores)
    app.dependency_overrides[runs.get_wallet] = lambda: LinkWallet(link, poll_seconds=0)
    return link


# --- the grocery list as a shopping list ----------------------------------------


def item(id, name, quantity=1.0, unit=None, checked=False):
    return GroceryItem(id=id, name=name, quantity_estimate=quantity, unit=unit, checked=checked)


def test_ticked_and_already_bought_items_are_left_out():
    rows = [item("a", "eggs"), item("b", "milk", checked=True), item("c", "rice"), item("d", " ")]
    listed, item_ids = shopping_items(rows, bought={"c"})
    assert [i.name for i in listed] == ["eggs"]
    assert item_ids == {"eggs": "a"}


@pytest.mark.parametrize("quantity", [None, 0, -2])
def test_an_item_with_no_usable_amount_is_one_pack_and_flagged(quantity):
    (listed,), _ = shopping_items([item("a", "Cabbage", quantity, "head")], bought=set())
    assert (listed.quantity, listed.unit, listed.assumed_quantity) == (1, "", True)


def test_a_known_amount_is_passed_on_as_it_is():
    (listed,), _ = shopping_items([item("a", "Rice", 2.5, "cup")], bought=set())
    assert (listed.name, listed.quantity, listed.unit) == ("Rice", 2.5, "cup")
    assert not listed.assumed_quantity


def test_one_name_in_two_units_becomes_one_flagged_item():
    rows = [item("a", "onion", 2, None), item("b", "Onion", 1, "cup")]
    (listed,), item_ids = shopping_items(rows, bought=set())
    assert (listed.name, listed.quantity, listed.assumed_quantity) == ("onion", 1, True)
    assert item_ids == {"onion": "a"}


def test_one_name_twice_in_the_same_unit_is_added_up():
    rows = [item("a", "onion", 2, "whole"), item("b", "onion", 1, "whole")]
    (listed,), _ = shopping_items(rows, bought=set())
    assert (listed.quantity, listed.unit, listed.assumed_quantity) == (3, "whole", False)


def test_a_very_long_name_is_cut_before_it_reaches_the_model():
    (listed,), item_ids = shopping_items([item("a", "x" * 300)], bought=set())
    assert len(listed.name) == 80
    assert item_ids == {listed.name: "a"}


async def test_an_assumed_amount_is_held_for_the_users_check_even_in_auto_mode():
    cart = CartService(
        InMemoryCartStore(),
        make_index([store("a")], [listing("a", "1", "cabbage", 300)]),
        ShoppingList([ListItem(name="Cabbage", quantity=1, assumed_quantity=True)]),
        "auto",
        20_000,
    )
    added = await cart.add(AddLine(ingredient="cabbage", store="a", upc="1"))
    assert (added.status, added.hold_reasons) == ("proposed", ["unknown_quantity"])


# --- signing in ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "authorization",
    [
        "",
        "Bearer not-a-token",
        # Signed with our secret but not a user's token, like the anon key.
        f"Bearer {jwt.encode({'role': 'anon'}, SECRET, algorithm='HS256')}",
        f"Bearer {token(exp=int(time.time()) - 10)}",
        f"Bearer {token(secret='another-secret-' + 'y' * 32)}",
    ],
    ids=["missing", "garbage", "anon key", "expired", "wrong secret"],
)
async def test_every_route_needs_a_signed_in_user(api, data, authorization):
    routes = [
        ("GET", "/api/orders"),
        ("GET", CART),
        ("POST", RUNS),
        ("POST", RECIPE_RUNS),
        ("GET", AUTO_BUY),
        ("PUT", AUTO_BUY),
    ]
    for method, path in routes:
        body = {"meals": MEALS, "remember": True, "auto_buy": True}
        response = await api.request(
            method, path, headers={"Authorization": authorization}, json=body
        )
        assert response.status_code == 401, (method, path)
    assert (data.rows, data.plans, data.auto_buy_on) == ({}, [], False)


async def test_a_users_own_token_is_accepted(api):
    assert (await api.get("/api/orders")).json() == []


# --- a run that stops at the cart -----------------------------------------------


async def test_a_run_without_payment_saves_the_cart_and_leaves_the_order_unpaid(api, data):
    response = await api.post(RUNS, json={"mode": "auto"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = events_of(response)
    assert [e["type"] for e in events[:2]] == ["run_created", "run_started"]
    assert events[1]["mode"] == "auto"
    assert events[-1]["type"] == "done"

    (order,) = data.rows.values()
    assert order["id"] == events[0]["order_id"]
    assert (order["status"], order["finish_reason"]) == ("unpaid", "completed")
    assert (order["mode"], order["budget_cents"]) == ("auto", 15_000)
    # The summary is kept for a page reload.
    assert order["summary"] == events[-1]["summary"]
    assert order["summary"]["unmatched"] == ["Dragon fruit"]
    assert len(await data.cart_store.list()) == 13
    assert data.touches > 0


async def test_the_mode_comes_from_the_users_preferences_unless_the_request_sets_it(api, data):
    data.mode = "auto"
    assert events_of(await api.post(RUNS))[1]["mode"] == "auto"
    assert events_of(await api.post(RUNS, json={"mode": "manual"}))[1]["mode"] == "manual"


async def test_each_run_starts_from_an_empty_cart(api, data):
    await api.post(RUNS)
    await api.post(RUNS)
    assert len(await data.cart_store.list()) == 13
    assert [row["status"] for row in data.rows.values()] == ["unpaid", "unpaid"]


async def test_the_cart_can_be_read_approved_and_edited(api):
    await api.post(RUNS, json={"mode": "manual"})

    cart = (await api.get(CART)).json()
    assert len(cart["items"]) == 13
    assert {item["status"] for item in cart["items"]} == {"proposed"}
    assert cart["in_cart"]["total_cents"] == 0
    assert cart["if_all_approved"]["total_cents"] == 4760  # delivery fees included

    approved = (await api.post(f"{CART}/approve")).json()
    assert {item["status"] for item in approved["items"]} == {"in_cart"}
    assert approved["in_cart"]["total_cents"] == 4760

    first = approved["items"][0]
    path = f"{CART}/items/{first['store']}/{first['upc']}"
    assert (await api.delete(path)).status_code == 204
    assert (await api.delete(path)).status_code == 404
    assert len((await api.get(CART)).json()["items"]) == 12


async def test_an_empty_cart_is_read_without_asking_the_stores(api, app):
    app.dependency_overrides[runs.get_storefront] = lambda: StorefrontClient(
        httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    )
    cart = (await api.get(CART)).json()
    assert (cart["items"], cart["in_cart"]["total_cents"]) == ([], 0)


# --- buying without being asked each time ---------------------------------------


async def test_auto_buy_is_off_until_the_user_turns_it_on(api):
    assert (await api.get(AUTO_BUY)).json() == {"auto_buy": False}

    assert (await api.put(AUTO_BUY, json={"auto_buy": True})).json() == {"auto_buy": True}
    assert (await api.get(AUTO_BUY)).json() == {"auto_buy": True}

    await api.put(AUTO_BUY, json={"auto_buy": False})
    assert (await api.get(AUTO_BUY)).json() == {"auto_buy": False}
    assert (await api.put(AUTO_BUY, json={})).status_code == 422


async def test_a_run_started_with_remember_turns_auto_buy_on(api, data):
    events = events_of(await api.post(RUNS, json={"remember": True}))

    assert events[-1]["type"] == "done"
    assert data.auto_buy_on


async def test_a_run_without_remember_leaves_the_saved_choice_alone(api, data):
    await api.post(RUNS)
    assert not data.auto_buy_on

    # The app starts later runs without the dialog, so without the field.
    data.auto_buy_on = True
    await api.post(RUNS, json={"mode": "auto", "remember": False})
    assert data.auto_buy_on


async def test_the_choice_is_kept_when_the_run_breaks(api, app, data):
    class Broken:
        async def complete(self, system, messages, tools):
            raise RuntimeError("boom")

    app.dependency_overrides[runs.get_model] = Broken

    events = events_of(await api.post(RUNS, json={"remember": True}))

    assert events[-1]["type"] == "error"
    assert data.auto_buy_on


async def test_a_run_that_is_refused_saves_no_choice(api, data):
    data.grocery.items = []
    assert (await api.post(RUNS, json={"remember": True})).status_code == 409

    unknown = [{"recipe_id": 7, "day_index": 0, "meal_type": "dinner"}]
    refused = await api.post(RECIPE_RUNS, json={"meals": unknown, "remember": True})
    assert refused.status_code == 404
    assert not data.auto_buy_on


async def test_a_recipe_run_can_remember_the_choice_too(api, data):
    events = events_of(await api.post(RECIPE_RUNS, json={"meals": MEALS, "remember": True}))

    assert events[-1]["type"] == "done"
    assert data.auto_buy_on


# --- a run for chosen recipes ---------------------------------------------------


async def test_chosen_recipes_are_saved_as_a_plan_and_shopped_for(api, data):
    body = {"meals": MEALS, "household_size": 3, "budget_cents": 20_000, "mode": "auto"}

    response = await api.post(RECIPE_RUNS, json=body)

    assert response.status_code == 200, response.text
    events = events_of(response)
    (order,) = data.rows.values()
    assert events[0] == {"type": "run_created", "order_id": order["id"], "grocery_list_id": LIST_ID}
    assert events[-1]["type"] == "done"
    assert (order["status"], order["mode"], order["budget_cents"]) == ("unpaid", "auto", 20_000)

    (plan,) = data.plans
    assert [(m.recipe_id, m.title, m.day_index, m.meal_type) for m in plan] == [
        ("38", "Garlic penne", 0, "dinner"),
        ("42", "Eggs and spinach", 1, "breakfast"),
    ]
    assert (plan[0].servings, plan[1].servings) == (4, None)
    # Every ingredient once, however many recipes use it.
    wanted = ["eggs", "garlic", "olive oil", "penne pasta", "spinach"]
    assert [item.name for item in data.grocery.items] == wanted

    cart = await data.cart_store.list()
    assert sorted(item.for_ingredient for item in cart) == wanted
    assert {item.quantity for item in cart} == {1}
    # One pack is the rule for a recipe, not a guess, so auto mode doesn't hold it.
    assert not any("unknown_quantity" in item.hold_reasons for item in cart)
    assert "in_cart" in {item.status for item in cart}


async def test_a_recipe_run_can_be_paid_in_the_same_run(api, app, data, stores, stripe):
    pay_with(app, stores)

    events = events_of(
        await api.post(RECIPE_RUNS, json={"meals": MEALS, "budget_cents": 20_000, "mode": "auto"})
    )

    assert events[-1]["type"] == "done", events[-1]
    (order,) = data.rows.values()
    assert order["status"] == "placed"
    assert len(order["order_items"]) == 5
    assert order["total_cents"] == stripe.charges[0]


async def test_an_unknown_recipe_is_not_found_and_nothing_is_saved(api, data):
    meals = [*MEALS, {"recipe_id": 7, "day_index": 2, "meal_type": "dinner"}]

    response = await api.post(RECIPE_RUNS, json={"meals": meals})

    assert (response.status_code, response.json()["detail"]) == (404, "No recipe with id 7")
    assert (data.plans, data.rows) == ([], {})


async def test_recipes_that_cannot_be_read_stop_the_run(api, app, data):
    app.dependency_overrides[runs.get_recipes] = recipes_from(lambda request: httpx.Response(404))

    response = await api.post(RECIPE_RUNS, json={"meals": MEALS})

    assert response.status_code == 503
    assert (data.plans, data.rows) == ([], {})


@pytest.mark.parametrize(
    "meals",
    [
        [],
        [MEALS[0], MEALS[0] | {"recipe_id": 42}],
        [MEALS[0] | {"meal_type": "brunch"}],
        [MEALS[0] | {"day_index": 31}],
    ],
    ids=["no meals", "two meals in one slot", "unknown meal type", "day past the plan"],
)
async def test_a_plan_that_cannot_be_saved_is_refused(api, data, meals):
    response = await api.post(RECIPE_RUNS, json={"meals": meals})

    assert response.status_code == 422
    assert (data.plans, data.rows) == ([], {})


# --- a run that pays ------------------------------------------------------------


async def test_a_paid_run_saves_one_order_with_a_line_for_every_product(
    api, app, data, stores, stripe
):
    pay_with(app, stores)

    events = events_of(await api.post(RUNS, json={"mode": "auto"}))

    (asked,) = [e for e in events if e["type"] == "approval_needed"]
    assert stripe.charges == [asked["total_cents"]] == [4760]
    (order,) = data.rows.values()
    assert (order["status"], order["total_cents"]) == ("placed", 4760)
    assert order["payment_reference"] == "pi_test_1"

    saved = (await api.get(f"/api/orders/{order['id']}")).json()
    lines = saved["order_items"]
    assert len(lines) == 13
    assert sum(line["line_total_cents"] for line in lines) + _delivery(events) == 4760
    assert {line["payment_reference"] for line in lines} == {"pi_test_1"}
    # One order number per store, and each line knows the grocery item it covers.
    assert len({line["store_order_id"] for line in lines}) == 3
    assert len({line["store"] for line in lines}) == 3
    by_ingredient = {line["for_ingredient"]: line for line in lines}
    assert by_ingredient["Eggs"]["grocery_item_id"] == "item-3"
    assert by_ingredient["Salmon fillet"]["status"] == "substituted"
    assert by_ingredient["Banana"]["status"] == "found"
    # Paid items have left the cart.
    assert (await api.get(CART)).json()["items"] == []
    assert [o["id"] for o in (await api.get("/api/orders")).json()] == [order["id"]]


def _delivery(events):
    (paid,) = [e for e in events if e["type"] == "tool_result" and e["name"] == "checkout"]
    return sum(order["delivery_fee_cents"] for order in paid["result"]["orders"])


async def test_a_second_run_only_shops_for_what_was_not_bought(api, app, data, stores, stripe):
    pay_with(app, stores)
    await api.post(RUNS)

    # Only the item the stores don't sell is left, and it still can't be found.
    events = events_of(await api.post(RUNS))
    searched = [e["arguments"]["query"] for e in events if e["type"] == "tool_call"]
    assert searched == ["Dragon fruit"]
    assert stripe.charges == [4760]
    assert [row["status"] for row in data.rows.values()] == ["placed", "unpaid"]


async def test_a_fully_bought_list_cannot_be_run_again(api, app, data, stores, stripe):
    data.grocery.items = [i for i in data.grocery.items if i.name != "Dragon fruit"]
    pay_with(app, stores)
    await api.post(RUNS)

    again = await api.post(RUNS)

    assert (again.status_code, again.json()["detail"]) == (
        409,
        "Nothing on this list is left to buy",
    )
    assert stripe.charges == [4760]
    assert len(data.rows) == 1


async def test_a_payment_that_cannot_be_saved_is_reported_with_its_reference(
    api, app, data, stores, stripe, monkeypatch
):
    async def no_wait(seconds):
        pass

    monkeypatch.setattr(service.asyncio, "sleep", no_wait)
    pay_with(app, stores)
    data.failing_saves = service.SAVE_ATTEMPTS

    events = events_of(await api.post(RUNS))

    (problem,) = [e for e in events if e["type"] == "error"]
    assert "pi_test_1" in problem["message"]
    assert stripe.charges == [4760]
    # The row is not left looking like a run still in progress.
    (order,) = data.rows.values()
    assert order["status"] == "placed"


async def test_saving_a_payment_is_tried_again_before_giving_up(
    api, app, data, stores, monkeypatch
):
    async def no_wait(seconds):
        pass

    monkeypatch.setattr(service.asyncio, "sleep", no_wait)
    pay_with(app, stores)
    data.failing_saves = service.SAVE_ATTEMPTS - 1

    events = events_of(await api.post(RUNS))

    assert not [e for e in events if e["type"] == "error"]
    (order,) = data.rows.values()
    assert (order["status"], len(order["order_items"])) == ("placed", 13)


# --- what a run refuses ---------------------------------------------------------


async def test_someone_elses_or_an_unknown_list_is_not_found(api, data):
    other = "99999999-9999-4999-8999-999999999999"
    for method, path in [
        ("POST", f"/api/grocery-lists/{other}/shopping-runs"),
        ("GET", f"/api/grocery-lists/{other}/cart"),
        ("POST", f"/api/grocery-lists/{other}/cart/approve"),
    ]:
        assert (await api.request(method, path)).status_code == 404, (method, path)
    assert (await api.get(f"/api/orders/{other}")).status_code == 404
    assert data.rows == {}


async def test_a_list_can_only_have_one_run_at_a_time(api, data):
    await api.post(RUNS)
    order_id = await data.start_run(data.grocery, "manual", None, stale_after=0)

    second = await api.post(RUNS)

    assert (second.status_code, "already in progress" in second.json()["detail"]) == (409, True)
    # The cart can't be edited under a run either.
    assert (await api.post(f"{CART}/approve")).status_code == 409
    assert len(await data.cart_store.list()) == 13
    assert data.rows[order_id]["status"] == "shopping"


async def test_a_run_that_breaks_is_closed_as_failed(api, app, data):
    class Broken:
        async def complete(self, system, messages, tools):
            raise RuntimeError("boom")

    app.dependency_overrides[runs.get_model] = Broken

    events = events_of(await api.post(RUNS))

    assert events[-1] == {"type": "error", "message": "The run stopped unexpectedly."}
    (order,) = data.rows.values()
    assert (order["status"], order["error_message"]) == ("failed", "The run stopped unexpectedly.")
