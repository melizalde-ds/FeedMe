"""The buying agent against the real local Supabase. Skipped unless you opt in:

    RUN_SUPABASE_TESTS=1 uv run --package api pytest apps/api/tests/test_supabase_live.py

Needs the stack from docker-compose.yaml running and the Supabase keys in .env.
Each test signs up a throwaway user and deletes it afterwards, which removes all
of its rows (set KEEP_LIVE_TEST_DATA=1 to keep them and look in Studio). The
stores, Stripe, Link and the model are the usual test doubles: nothing here can
start a real payment, whatever .env says. For a real sandbox payment see
test_sandbox_live.py.
"""

import os
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from link_fakes import FakeLink, FakeStripe, storefront_app
from live_supabase import (  # noqa: F401 - the last three are fixtures
    SAMPLE,
    as_user,
    events_of,
    ingredients,
    service,
    sign_up,
    supabase_settings,
)
from postgrest import APIError
from run_fakes import MEALS, qdrant, recipes_from

from api.agent.providers.scripted import ScriptedProvider
from api.main import create_app
from api.runs import router as runs
from api.runs.data import PlannedMeal, SupabaseShoppingData
from api.shopping.client import StorefrontClient
from api.wallet.link import LinkWallet

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(
        os.environ.get("RUN_SUPABASE_TESTS") != "1",
        reason="set RUN_SUPABASE_TESTS=1 to run against the local Supabase stack",
    ),
]


@pytest.fixture
def stripe():
    return FakeStripe()


@pytest.fixture
async def api(supabase_settings, stripe):
    """The real app with its real Supabase access, but fake stores and payment."""
    app = create_app(supabase_settings)
    transport = httpx.ASGITransport(app=storefront_app(stripe))
    async with (
        httpx.AsyncClient(transport=transport, base_url="http://storefront") as stores,
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api") as client,
    ):
        wallet = LinkWallet(FakeLink(stores), poll_seconds=0)
        app.dependency_overrides |= {
            runs.get_storefront: lambda: StorefrontClient(stores),
            runs.get_recipes: recipes_from(qdrant),
            runs.get_model: ScriptedProvider,
            runs.get_wallet: lambda: wallet,
        }
        client.app = app
        yield client


async def test_a_paid_run_is_stored_and_a_second_run_only_buys_the_rest(
    api, sign_up, service, stripe
):
    account = await sign_up()
    listed = ingredients(SAMPLE)
    eggs = next(i for i in listed if i["name"] == "Eggs")
    eggs["quantity"] = "a few"  # no usable amount: bought as one pack, held for a check
    await account.plan_groceries(listed)

    response = await api.post(account.runs, json={"mode": "auto"}, headers=as_user(account))

    assert response.status_code == 200, response.text
    events = events_of(response)
    assert events[-1]["type"] == "done", events[-1]
    assert events[1]["mode"] == "auto"  # the plan's budget made auto possible
    assert len(stripe.charges) == 1

    # Read back as the user, through the API.
    (listed_order,) = (await api.get("/api/orders", headers=as_user(account))).json()
    assert listed_order["id"] == events[0]["order_id"]
    order = (await api.get(f"/api/orders/{listed_order['id']}", headers=as_user(account))).json()
    assert (order["status"], order["mode"], order["budget_cents"]) == ("placed", "auto", 15_000)
    assert order["total_cents"] == stripe.charges[0]
    assert order["subtotal_cents"] + order["delivery_fee_cents"] == order["total_cents"]
    assert order["payment_reference"] == "pi_test_1"
    assert order["placed_at"] and order["finish_reason"] == "completed"
    assert order["summary"]["unmatched"] == ["dragon fruit"]
    lines = order["order_items"]
    assert len(lines) == 13
    assert all(line["grocery_item_id"] and line["store_order_id"] for line in lines)
    assert sum(line["line_total_cents"] for line in lines) == order["subtotal_cents"]
    assert next(line for line in lines if line["for_ingredient"] == "eggs")["quantity"] == 1

    # The paid items left the cart.
    cart = (await api.get(account.cart, headers=as_user(account))).json()
    assert cart["items"] == []
    stored = await service.table("orders").select("receipt").eq("id", order["id"]).execute()
    assert [p["payment_reference"] for p in stored.data[0]["receipt"]] == ["pi_test_1"]

    # The plan has an order now, so its grocery list can't be rebuilt.
    with pytest.raises(APIError, match="locked"):
        await account.db.rpc("build_grocery_list", {"p_plan_id": account.plan_id}).execute()

    # A second run only looks for what wasn't bought, and pays nothing more.
    again = events_of(await api.post(account.runs, headers=as_user(account)))
    searched = [e["arguments"]["query"] for e in again if e["type"] == "tool_call"]
    assert searched == ["dragon fruit"]
    assert len(stripe.charges) == 1
    statuses = await service.table("orders").select("status").eq("user_id", account.id).execute()
    assert sorted(row["status"] for row in statuses.data) == ["placed", "unpaid"]


async def test_the_cart_is_stored_per_list_and_only_the_server_can_write_it(
    api, sign_up, service
):
    account, stranger = await sign_up(), await sign_up()
    listed = ingredients(SAMPLE)
    next(i for i in listed if i["name"] == "Eggs")["quantity"] = "a few"
    await account.plan_groceries(listed)
    api.app.dependency_overrides[runs.get_wallet] = lambda: None  # stop at the cart

    events = events_of(await api.post(account.runs, json={"mode": "auto"}, headers=as_user(account)))

    assert events[-1]["type"] == "done", events[-1]
    cart = (await api.get(account.cart, headers=as_user(account))).json()
    assert len(cart["items"]) == 13
    eggs = next(item for item in cart["items"] if item["for_ingredient"] == "eggs")
    assert (eggs["quantity"], eggs["status"]) == (1, "proposed")
    assert "unknown_quantity" in eggs["hold_reasons"]
    assert cart["in_cart"]["total_cents"] < cart["if_all_approved"]["total_cents"]

    # Row level security: the owner can read the rows but not change them, and
    # nobody else can see them.
    own = await account.db.table("cart_items").select("store, upc").execute()
    assert len(own.data) == 13
    assert (await stranger.db.table("cart_items").select("id").execute()).data == []
    with pytest.raises(APIError, match="permission denied"):
        await account.db.table("cart_items").update({"unit_price_cents": 1}).eq(
            "user_id", account.id
        ).execute()
    with pytest.raises(APIError, match="permission denied"):
        await account.db.table("cart_items").delete().eq("user_id", account.id).execute()
    for method, path in [("GET", account.cart), ("POST", account.runs)]:
        other = await api.request(method, path, headers=as_user(stranger))
        assert other.status_code == 404, (method, path)

    approved = (await api.post(f"{account.cart}/approve", headers=as_user(account))).json()
    assert {item["status"] for item in approved["items"]} == {"in_cart"}
    first = approved["items"][0]
    path = f"{account.cart}/items/{first['store']}/{first['upc']}"
    assert (await api.delete(path, headers=as_user(account))).status_code == 204
    assert (await api.delete(path, headers=as_user(account))).status_code == 404

    # The run paid nothing, so the list can be rebuilt, which empties its cart.
    (order,) = (await api.get("/api/orders", headers=as_user(account))).json()
    assert order["status"] == "unpaid"
    await account.db.rpc("build_grocery_list", {"p_plan_id": account.plan_id}).execute()
    assert (await account.db.table("cart_items").select("id").execute()).data == []


async def test_auto_buy_is_stored_in_the_users_own_preferences(api, sign_up, service):
    account, stranger = await sign_up(), await sign_up()
    await account.plan_groceries(ingredients(SAMPLE))
    api.app.dependency_overrides[runs.get_wallet] = lambda: None  # stop at the cart
    # A user who already has preferences keeps them.
    await stranger.db.table("preferences").insert(
        {"user_id": stranger.id, "liked_foods": ["rice"], "shopping_mode": "auto"}
    ).execute()

    # A new user has no preferences row yet.
    assert (await api.get("/api/auto-buy", headers=as_user(account))).json() == {"auto_buy": False}

    started = await api.post(account.runs, json={"remember": True}, headers=as_user(account))
    events = events_of(started)

    assert events[-1]["type"] == "done", events[-1]
    assert (await api.get("/api/auto-buy", headers=as_user(account))).json() == {"auto_buy": True}
    assert (await api.get("/api/auto-buy", headers=as_user(stranger))).json() == {"auto_buy": False}

    for user in (account, stranger):
        turned_on = await api.put("/api/auto-buy", json={"auto_buy": True}, headers=as_user(user))
        assert turned_on.json() == {"auto_buy": True}
    off = await api.put("/api/auto-buy", json={"auto_buy": False}, headers=as_user(account))
    assert off.json() == {"auto_buy": False}

    rows = await service.table("preferences").select("*").in_(
        "user_id", [account.id, stranger.id]
    ).execute()
    saved = {row["user_id"]: row for row in rows.data}
    assert (saved[account.id]["auto_buy"], saved[account.id]["shopping_mode"]) == (False, "manual")
    assert saved[stranger.id]["auto_buy"]
    assert (saved[stranger.id]["liked_foods"], saved[stranger.id]["shopping_mode"]) == (
        ["rice"],
        "auto",
    )


async def test_one_run_at_a_time_and_a_dead_run_does_not_block_forever(api, sign_up, service):
    account = await sign_up()
    await account.plan_groceries(ingredients(SAMPLE[:2]))
    running = {
        "user_id": account.id,
        "plan_id": account.plan_id,
        "grocery_list_id": account.list_id,
        "status": "shopping",
    }
    first = (await service.table("orders").insert(running).execute()).data[0]

    blocked = await api.post(account.runs, headers=as_user(account))
    assert blocked.status_code == 409, blocked.text
    assert (await api.post(f"{account.cart}/approve", headers=as_user(account))).status_code == 409
    # The database itself refuses a second running order for the list.
    with pytest.raises(APIError, match="orders_one_active_run"):
        await service.table("orders").insert(running).execute()

    # A run that has shown no sign of life for an hour is closed, and the next one starts.
    await service.table("orders").delete().eq("id", first["id"]).execute()
    an_hour_ago = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    dead = (
        await service.table("orders").insert(running | {"updated_at": an_hour_ago}).execute()
    ).data[0]

    events = events_of(await api.post(account.runs, headers=as_user(account)))

    assert events[-1]["type"] == "done", events[-1]
    closed = await service.table("orders").select("status, error_message").eq("id", dead["id"]).execute()
    assert closed.data == [{"status": "failed", "error_message": "The run was interrupted."}]


async def test_chosen_recipes_are_stored_as_a_plan_and_bought_one_pack_each(
    api, sign_up, service, stripe
):
    account = await sign_up()
    body = {"meals": MEALS, "household_size": 3, "budget_cents": 20_000, "mode": "auto"}

    response = await api.post("/api/shopping-runs", json=body, headers=as_user(account))

    assert response.status_code == 200, response.text
    events = events_of(response)
    assert events[-1]["type"] == "done", events[-1]
    list_id = events[0]["grocery_list_id"]

    # Read back as the user: the plan, its slots and the list are their own rows.
    slots = "meal_plan_slots(recipe_id, title, day_index, meal_type, servings, ingredients)"
    plans = await account.db.table("meal_plans").select(f"*, {slots}").execute()
    (plan,) = plans.data
    assert (plan["household_size"], plan["budget"], plan["num_days"]) == (3, 200, 2)
    penne, eggs = sorted(plan["meal_plan_slots"], key=lambda slot: slot["day_index"])
    assert (penne["recipe_id"], penne["title"], penne["servings"]) == ("38", "Garlic penne", 4)
    assert penne["ingredients"] == [{"name": "penne pasta"}, {"name": "garlic"}, {"name": "olive oil"}]
    assert (eggs["recipe_id"], eggs["meal_type"], eggs["servings"]) == ("42", "breakfast", None)

    wanted = ["eggs", "garlic", "olive oil", "penne pasta", "spinach"]
    items = await (
        account.db.table("grocery_items")
        .select("name, quantity_estimate, unit")
        .eq("list_id", list_id)
        .order("name")
        .execute()
    )
    assert items.data == [{"name": name, "quantity_estimate": 1, "unit": None} for name in wanted]

    # One payment for one pack of each, with nothing held back as an unknown amount.
    (order,) = (await api.get("/api/orders", headers=as_user(account))).json()
    order = (await api.get(f"/api/orders/{order['id']}", headers=as_user(account))).json()
    assert (order["status"], order["grocery_list_id"]) == ("placed", list_id)
    assert order["total_cents"] == stripe.charges[0]
    assert sorted(line["for_ingredient"] for line in order["order_items"]) == wanted
    assert {line["quantity"] for line in order["order_items"]} == {1}


async def test_a_plan_that_fails_halfway_leaves_nothing_behind(sign_up, service):
    account = await sign_up()
    await account.plan_groceries(ingredients(SAMPLE[:2]))  # an earlier plan, to be left alone
    data = SupabaseShoppingData(account.db, service, account.id)
    meal = {"recipe_id": "38", "title": "Garlic penne", "day_index": 0, "ingredients": ["garlic"]}
    # Not a meal type the slots table takes, so saving the slot fails.
    broken = PlannedMeal.model_construct(**meal, meal_type="brunch", servings=None, image_url=None)

    with pytest.raises(APIError, match="meal_type"):
        await data.save_plan([broken], household_size=1, budget_cents=None)

    for table in ("meal_option_sessions", "meal_options", "meal_plans", "grocery_lists"):
        rows = await service.table(table).select("id").eq("user_id", account.id).execute()
        assert len(rows.data) == 1, table
    plans = await service.table("meal_plans").select("id").eq("user_id", account.id).execute()
    assert plans.data == [{"id": account.plan_id}]

