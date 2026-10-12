"""The routes a household saves itself through: preferences, allergies and
nutrition targets. Supabase is replaced by the stand-in in household_fakes.py;
test_household_live.py runs the same routes against the real tables."""

import time

import httpx
import jwt
import pytest
from household_fakes import FakeAllergenList, FakeHouseholdStore

from api.auth import CurrentUser
from api.household import router as household
from api.household.schemas import NutritionTargets, Preferences
from api.main import create_app
from api.settings import Settings

pytestmark = pytest.mark.anyio

SECRET = "test-secret-" + "x" * 32
USER = "44444444-4444-4444-8444-444444444444"
GUEST = {"Authorization": ""}
TARGETS = {"calories": 2000, "protein_g": 100, "carbs_g": 250, "fat_g": 67}


def token():
    payload = {"sub": USER, "aud": "authenticated", "exp": int(time.time()) + 600}
    return jwt.encode(payload, SECRET, algorithm="HS256")


@pytest.fixture
def store():
    return FakeHouseholdStore()


@pytest.fixture
async def client(store):
    settings = Settings(
        _env_file=None,
        supabase_jwt_secret=SECRET,
        supabase_anon_key="anon",
        supabase_service_role_key="service",
    )
    app = create_app(settings)

    # Still asks for the signed-in user, so the real token check runs.
    def signed_in_store(user: CurrentUser):
        assert user.id == USER
        return store

    app.dependency_overrides |= {
        household.get_household_store: signed_in_store,
        household.get_allergen_list: FakeAllergenList,
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as http:
        http.headers["Authorization"] = f"Bearer {token()}"
        yield http


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/preferences"),
        ("PUT", "/api/preferences"),
        ("GET", "/api/allergies"),
        ("POST", "/api/allergies"),
        ("GET", "/api/nutrition-goals"),
        ("PUT", "/api/nutrition-goals"),
    ],
)
async def test_a_households_own_data_needs_a_signed_in_user(client, method, path):
    response = await client.request(method, path, headers=GUEST, json={})
    assert response.status_code == 401


async def test_a_guest_can_read_the_common_allergens(client):
    response = await client.get("/api/allergens", headers=GUEST)
    assert response.status_code == 200
    assert response.json()[0] == {"id": "milk", "label": "Milk / dairy"}


async def test_preferences_are_null_until_saved_then_come_back_cleaned(client):
    assert (await client.get("/api/preferences")).json() is None

    body = {
        "diet_styles": ["Vegetarian"],
        "liked_foods": [" Tofu ", "rice", "tofu"],
        "plan_days": 5,
    }
    saved = await client.put("/api/preferences", json=body)

    assert saved.status_code == 200, saved.text
    assert (
        saved.json()
        == Preferences(
            diet_styles=["vegetarian"], liked_foods=["rice", "tofu"], plan_days=5
        ).model_dump()
    )
    assert (await client.get("/api/preferences")).json() == saved.json()


@pytest.mark.parametrize(
    ("change", "said"),
    [
        ({"household_size": 0}, "Household size"),
        ({"household_size": 21}, "Household size"),
        ({"weekly_budget": -1}, "Weekly budget"),
        ({"max_cook_time_minutes": 0}, "Cooking time"),
        ({"plan_days": 32}, "between 1 and 31 days"),
        ({"meals_per_day": 5}, "Meals per day"),
    ],
)
async def test_preferences_out_of_range_are_refused_in_words(client, store, change, said):
    response = await client.put("/api/preferences", json=change)
    assert response.status_code == 422
    assert said in response.json()["detail"]
    assert store.saved_preferences is None


async def test_a_term_the_database_refuses_is_passed_on_in_words(client):
    response = await client.put("/api/preferences", json={"liked_foods": ["x"]})
    assert response.status_code == 422
    assert response.json()["detail"] == 'Liked foods: "x" is too short.'


async def test_allergies_are_added_one_at_a_time_and_listed_in_full(client):
    assert (await client.get("/api/allergies")).json() == []

    first = await client.post("/api/allergies", json={"allergen_id": "milk"})
    second = await client.post("/api/allergies", json={"name": "Strawberries"})

    assert first.status_code == second.status_code == 201
    assert second.json() == [
        {"allergen": "milk", "label": "Milk / dairy", "kind": "common"},
        {"allergen": "strawberries", "label": "strawberries", "kind": "custom"},
    ]
    assert (await client.get("/api/allergies")).json() == second.json()


async def test_adding_an_allergy_twice_changes_nothing(client):
    for _ in range(2):
        response = await client.post("/api/allergies", json={"allergen_id": "peanut"})
        assert response.status_code == 201
    assert [a["allergen"] for a in response.json()] == ["peanut"]


async def test_a_typed_name_the_list_knows_is_stored_as_the_common_allergen(client):
    response = await client.post("/api/allergies", json={"name": "Dairy"})
    assert response.json() == [{"allergen": "milk", "label": "Milk / dairy", "kind": "common"}]


@pytest.mark.parametrize(
    "body", [{}, {"name": "  "}, {"allergen_id": "milk", "name": "strawberries"}]
)
async def test_an_allergy_needs_exactly_one_of_id_and_name(client, store, body):
    response = await client.post("/api/allergies", json=body)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)
    assert store.common == store.custom == []


async def test_an_allergen_not_on_the_list_is_not_found(client):
    response = await client.post("/api/allergies", json={"allergen_id": "kryptonite"})
    assert response.status_code == 404


async def test_a_name_the_database_refuses_is_passed_on_in_words(client):
    response = await client.post("/api/allergies", json={"name": "x"})
    assert response.status_code == 422
    assert response.json()["detail"] == 'Allergen "x" is too short.'


@pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE"])
async def test_allergies_cannot_be_changed_or_removed(client, method):
    await client.post("/api/allergies", json={"allergen_id": "milk"})
    for path in ("/api/allergies", "/api/allergies/milk"):
        assert (await client.request(method, path)).status_code in (404, 405)
    assert len((await client.get("/api/allergies")).json()) == 1


async def test_nutrition_goals_are_null_until_saved(client):
    assert (await client.get("/api/nutrition-goals")).json() is None

    saved = await client.put("/api/nutrition-goals", json=TARGETS)

    assert saved.status_code == 200, saved.text
    assert saved.json() == TARGETS
    assert (await client.get("/api/nutrition-goals")).json() == TARGETS


@pytest.mark.parametrize(
    ("change", "said"),
    [
        ({"calories": 1100, "protein_g": 60, "carbs_g": 140, "fat_g": 33}, "at least 1200"),
        ({"protein_g": -1}, "can't be negative"),
        ({"fat_g": 150}, "more than 10% away"),
    ],
)
async def test_nutrition_goals_the_table_would_refuse_are_refused_in_words(
    client, store, change, said
):
    response = await client.put("/api/nutrition-goals", json=TARGETS | change)
    assert response.status_code == 422
    assert said in response.json()["detail"]
    assert store.saved_nutrition is None


def test_macros_may_be_up_to_ten_percent_off_the_calorie_target():
    # 100 g protein + 250 g carbs = 1400 kcal, so 2000 kcal needs about 67 g of fat.
    def problem(fat_g):
        return NutritionTargets(calories=2000, protein_g=100, carbs_g=250, fat_g=fat_g).problem()

    assert problem(45) is None  # 1805 kcal, 9.75% under
    assert problem(88) is None  # 2192 kcal, 9.6% over
    assert problem(44) is not None  # 1796 kcal, 10.2% under
    assert problem(90) is not None  # 2210 kcal, 10.5% over
