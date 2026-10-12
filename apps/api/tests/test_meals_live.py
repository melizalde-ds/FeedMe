"""The meal planner's routes against the real local Supabase. Skipped unless you
opt in, the same way as test_supabase_live.py:

    RUN_SUPABASE_TESTS=1 uv run --package api pytest apps/api/tests/test_meals_live.py

Needs the stack from docker-compose.yaml running, with migration 0002 applied.
Each test signs up a throwaway user and deletes it afterwards. Qdrant, the
models and Jev are the usual stand-ins, so this costs nothing and proves the
database side: what is read about a household, and what is saved.
"""

import os

import httpx
import pytest
from live_supabase import as_user, service, sign_up, supabase_settings  # noqa: F401 - fixtures
from meal_fakes import FakeJudge, FakeQdrant, recipe
from test_meals import planner

from api.main import create_app
from api.meals import router as meals

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(
        os.environ.get("RUN_SUPABASE_TESTS") != "1",
        reason="set RUN_SUPABASE_TESTS=1 to run against the local Supabase stack",
    ),
]

RECIPES = [
    recipe(9001, "Cheesy rice", ["rice", "cheddar cheese"]),
    recipe(9002, "Chicken rice", ["rice", "chicken breast"]),
    *(recipe(9010 + i, f"Rice bowl {i}", ["rice", "carrot"]) for i in range(1, 9)),
]


@pytest.fixture
async def api(supabase_settings):
    """The real app with its real Supabase access, and stand-ins for the rest."""
    app = create_app(supabase_settings)
    qdrant = FakeQdrant(RECIPES)
    app.dependency_overrides |= {
        meals.get_planner: lambda: planner(qdrant, judge=FakeJudge()),
        meals.get_recipe_cards: qdrant.client,
    }
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api") as client,
    ):
        yield client


async def household(sign_up):
    """A user who avoids milk and strawberries, eats vegetarian and plans two days."""
    account = await sign_up()
    user = {"user_id": account.id}
    await account.db.table("user_allergens").insert(user | {"allergen_id": "milk"}).execute()
    # Typed as a custom allergen. "Dairy" is stored as the common one instead.
    for name in ("Strawberries", "dairy"):
        await account.db.table("user_custom_allergens").insert(user | {"name": name}).execute()
    preferences = {"diet_styles": ["vegetarian"], "plan_days": 2, "meals_per_day": 1}
    await account.db.table("preferences").insert(user | preferences).execute()
    return account


async def test_a_run_reads_the_household_and_saves_its_options(api, sign_up, service):
    account = await household(sign_up)
    response = await api.post("/api/meal-options", headers=as_user(account))
    assert response.status_code == 201, response.text
    body = response.json()
    # One meal a day is dinner. Neither the cheese nor the chicken recipe.
    assert list(body["meals"]) == ["dinner"]
    titles = [option["title"] for option in body["meals"]["dinner"]]
    assert titles == [f"Rice bowl {i}" for i in range(1, 6)]

    session = (
        await service.table("meal_option_sessions")
        .select("*, meal_options(*)")
        .eq("id", body["session_id"])
        .execute()
    ).data[0]
    assert session["status"] == "ready"
    assert session["allergies_snapshot"] == ["milk", "strawberries"]
    assert session["preferences_snapshot"]["diet_styles"] == ["vegetarian"]
    rows = sorted(session["meal_options"], key=lambda row: row["rank"])
    assert [(r["meal_type"], r["day_index"], r["status"]) for r in rows] == [
        ("dinner", 0, "shown"),
        ("dinner", 1, "shown"),
        ("dinner", None, "queued"),
        ("dinner", None, "queued"),
        ("dinner", None, "queued"),
    ]
    assert all(r["allergen_safe"] and r["user_id"] == account.id for r in rows)
    assert set(rows[0]["compliance"]["checks"]) == {
        "allergen:milk",
        "allergen:strawberry",
        "diet:vegetarian",
    }

    again = await api.get(f"/api/meal-options/{body['session_id']}", headers=as_user(account))
    assert again.status_code == 200 and again.json() == body | {"warnings": []}


async def test_meals_already_shown_are_not_suggested_again(api, sign_up):
    account = await household(sign_up)
    first = (await api.post("/api/meal-options", headers=as_user(account))).json()
    second = (await api.post("/api/meal-options", headers=as_user(account))).json()
    titles = lambda body: [option["title"] for option in body["meals"]["dinner"]]  # noqa: E731
    # The two that were set on days are left out. The alternatives never
    # shown can come back.
    assert titles(first)[:2] == ["Rice bowl 1", "Rice bowl 2"]
    assert titles(second) == [f"Rice bowl {i}" for i in range(3, 8)]


async def test_one_users_options_are_hidden_from_another(api, sign_up):
    owner, other = await household(sign_up), await sign_up()
    created = (await api.post("/api/meal-options", headers=as_user(owner))).json()
    response = await api.get(f"/api/meal-options/{created['session_id']}", headers=as_user(other))
    assert response.status_code == 404
