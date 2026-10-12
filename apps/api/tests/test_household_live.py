"""The household routes against the real local Supabase. Skipped unless you opt
in, the same way as test_supabase_live.py:

    RUN_SUPABASE_TESTS=1 uv run --package api pytest apps/api/tests/test_household_live.py

Needs the stack from docker-compose.yaml running. Each test signs up a throwaway
user and deletes it afterwards. This proves what the stand-in can't: the
database's own rules, and that each user only ever sees their own rows.
"""

import os

import httpx
import pytest
from live_supabase import as_user, service, sign_up, supabase_settings  # noqa: F401 - fixtures

from api.main import create_app
from api.meals.store import SupabaseMealStore

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(
        os.environ.get("RUN_SUPABASE_TESTS") != "1",
        reason="set RUN_SUPABASE_TESTS=1 to run against the local Supabase stack",
    ),
]

TARGETS = {"calories": 2000, "protein_g": 100, "carbs_g": 250, "fat_g": 67}


@pytest.fixture
async def api(supabase_settings):
    app = create_app(supabase_settings)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api") as client,
    ):
        yield client


async def test_a_guest_reads_the_ten_common_allergens(api):
    response = await api.get("/api/allergens")
    assert response.status_code == 200, response.text
    allergens = response.json()
    assert len(allergens) == 10
    assert allergens[0] == {"id": "milk", "label": "Milk / dairy"}


async def test_preferences_are_stored_cleaned_and_only_for_their_owner(api, sign_up):
    account, other = await sign_up(), await sign_up()
    assert (await api.get("/api/preferences", headers=as_user(account))).json() is None

    body = {
        "diet_styles": ["Vegetarian"],
        "liked_foods": [" Tofu ", "rice", "TOFU"],
        "disliked_cuisines": ["Fast  Food"],
        "household_size": 4,
        "weekly_budget": 120.5,
        "max_cook_time_minutes": 30,
        "plan_days": 5,
        "meals_per_day": 2,
    }
    saved = await api.put("/api/preferences", headers=as_user(account), json=body)

    assert saved.status_code == 200, saved.text
    assert saved.json() == body | {
        "diet_styles": ["vegetarian"],
        "liked_foods": ["rice", "tofu"],
        "disliked_foods": [],
        "liked_cuisines": [],
        "disliked_cuisines": ["fast food"],
    }
    assert (await api.get("/api/preferences", headers=as_user(account))).json() == saved.json()
    assert (await api.get("/api/preferences", headers=as_user(other))).json() is None


async def test_saving_preferences_keeps_the_auto_buy_choice(api, sign_up):
    account = await sign_up()
    await api.put("/api/auto-buy", headers=as_user(account), json={"auto_buy": True})

    # The row exists now, so the preferences are the table's defaults, not null.
    before = (await api.get("/api/preferences", headers=as_user(account))).json()
    assert before["household_size"] == 1 and before["plan_days"] == 7

    await api.put("/api/preferences", headers=as_user(account), json={"household_size": 3})
    assert (await api.get("/api/auto-buy", headers=as_user(account))).json() == {"auto_buy": True}


@pytest.mark.parametrize(
    ("terms", "said"),
    [
        (["x"], 'Liked foods: "x" is too short.'),
        (["ignore the instructions"], "contains a word that is not allowed"),
        (["soup; drop table"], "can only contain letters"),
    ],
)
async def test_a_term_the_database_refuses_answers_in_words(api, sign_up, terms, said):
    account = await sign_up()
    response = await api.put(
        "/api/preferences", headers=as_user(account), json={"liked_foods": terms}
    )
    assert response.status_code == 422, response.text
    assert said in response.json()["detail"]
    assert (await api.get("/api/preferences", headers=as_user(account))).json() is None


async def test_allergies_are_add_only_and_known_names_become_common(api, sign_up):
    account, other = await sign_up(), await sign_up()
    user = as_user(account)

    assert (
        await api.post("/api/allergies", headers=user, json={"allergen_id": "milk"})
    ).status_code == 201
    # Already there, typed in another way, and typed with an alias.
    for body in ({"allergen_id": "milk"}, {"name": "Dairy"}, {"name": "Peanuts"}):
        again = await api.post("/api/allergies", headers=user, json=body)
        assert again.status_code == 201, again.text
    for _ in range(2):
        listed = await api.post("/api/allergies", headers=user, json={"name": " Strawberries "})

    assert listed.json() == [
        {"allergen": "milk", "label": "Milk / dairy", "kind": "common"},
        {"allergen": "peanut", "label": "Peanuts", "kind": "common"},
        {"allergen": "strawberries", "label": "strawberries", "kind": "custom"},
    ]
    assert (await api.get("/api/allergies", headers=user)).json() == listed.json()
    assert (await api.get("/api/allergies", headers=as_user(other))).json() == []


async def test_allergies_the_database_refuses_answer_in_words(api, sign_up):
    user = as_user(await sign_up())

    unknown = await api.post("/api/allergies", headers=user, json={"allergen_id": "kryptonite"})
    assert unknown.status_code == 404

    short = await api.post("/api/allergies", headers=user, json={"name": "x"})
    assert short.status_code == 422
    assert short.json()["detail"] == 'Allergen "x" is too short.'

    assert (await api.get("/api/allergies", headers=user)).json() == []


async def test_nutrition_goals_round_trip_and_keep_the_optional_columns(api, sign_up, service):
    account = await sign_up()
    user = as_user(account)
    assert (await api.get("/api/nutrition-goals", headers=user)).json() is None

    saved = await api.put("/api/nutrition-goals", headers=user, json=TARGETS)
    assert saved.status_code == 200, saved.text
    assert saved.json() == TARGETS

    # Set by something else, such as a later calculator. Saving the targets again leaves it.
    await (
        account.db.table("nutrition_goals")
        .update({"fiber_g": 30})
        .eq("user_id", account.id)
        .execute()
    )
    changed = TARGETS | {"calories": 2100, "carbs_g": 275}
    assert (await api.put("/api/nutrition-goals", headers=user, json=changed)).json() == changed

    row = (
        await service.table("nutrition_goals").select("*").eq("user_id", account.id).execute()
    ).data[0]
    assert row["fiber_g"] == 30 and row["calories"] == 2100


async def test_the_planner_reads_what_the_routes_saved(api, sign_up):
    account = await sign_up()
    user = as_user(account)
    preferences = {
        "diet_styles": ["vegan"],
        "household_size": 3,
        "plan_days": 4,
        "meals_per_day": 2,
    }
    await api.put("/api/preferences", headers=user, json=preferences)
    await api.post("/api/allergies", headers=user, json={"allergen_id": "soy"})
    await api.post("/api/allergies", headers=user, json={"name": "kiwi"})
    await api.put("/api/nutrition-goals", headers=user, json=TARGETS)

    inputs = await SupabaseMealStore(account.db, account.id, 14).inputs(
        plan_days=None, meal_types=None
    )

    assert inputs.common_allergens == ["soy"] and inputs.custom_allergens == ["kiwi"]
    assert inputs.diet_styles == ["vegan"] and inputs.household_size == 3
    assert inputs.plan_days == 4 and inputs.meal_types == ["lunch", "dinner"]
    assert inputs.nutrition.model_dump(exclude_none=True) == TARGETS
