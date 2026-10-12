"""The meal planner: the diet rules, the search filter, the query writer, the
safety check, the pipeline and its routes. Qdrant, the models, Jev and Supabase
are replaced by the stand-ins in meal_fakes.py."""

import json
import time

import httpx
import jwt
import pytest
from meal_fakes import (
    MODEL_DOWN,
    FakeEmbedder,
    FakeJudge,
    FakeMealStore,
    FakeModel,
    FakeQdrant,
    dishes,
    recipe,
)

from api.agent.providers.base import AssistantMessage
from api.allergens import load_matcher
from api.auth import CurrentUser
from api.allergens.profile import resolve_household
from api.main import create_app
from api.meals import router as meals
from api.meals.diets import RULES, DietBook, split_styles
from api.meals.pantry import Pantry
from api.meals.pipeline import Limits, MealPlanner, PlannerUnavailable
from api.meals.query import LlmQueryWriter, TemplateQueryWriter, card
from api.meals.rerank import PassThroughReranker
from api.meals.safety import SafetyChecker
from api.meals.schemas import PlanInputs, Served
from api.meals.store import option_rows
from api.recipes.client import RecipeCard
from api.settings import Settings

pytestmark = pytest.mark.anyio

SECRET = "test-secret-" + "x" * 32
USER = "33333333-3333-4333-8333-333333333333"
MATCHER = load_matcher()
BOOK = DietBook(MATCHER)

# Twelve plain dinners, then the ones the tests are about.
PLAIN = [recipe(i, f"Rice bowl {i}", ["rice", "carrot", "onion"]) for i in range(1, 13)]
CHEESY = recipe(50, "Cheesy rice", ["rice", "cheddar cheese"])
# The word list passes "dream whip", which is made with milk. Jev knows.
BRAND = recipe(51, "Fluffy rice", ["rice", "dream whip"])
# Clean ingredients, milk in the steps.
STEPS = recipe(52, "Buttered rice", ["rice", "salt"], ["Boil the rice.", "Stir in the butter."])
CHICKEN = recipe(53, "Chicken rice", ["rice", "chicken breast"])
SAUCE = recipe(54, "Pan sauce", ["tomato", "onion"], is_component=True)
CAKE = recipe(55, "Carrot cake", ["carrot", "sugar"], category="Dessert")


def card_of(point):
    return RecipeCard(id=point["id"], **point["payload"])


def checker(judge=None, **limits):
    limits = {"allergen_threshold": 0.2, "diet_threshold": 0.4} | limits
    return SafetyChecker(MATCHER, BOOK, judge or FakeJudge(), **limits)


def household(*common, custom=()):
    return resolve_household(MATCHER, common, custom)


def planner(qdrant, *, judge=None, writer=None, reranker=None, limits=None):
    recipes = qdrant.client()

    async def pantry():
        return Pantry(MATCHER, BOOK, await recipes.ingredient_names())

    return MealPlanner(
        matcher=MATCHER,
        recipes=recipes,
        pantry=pantry,
        writer=writer or TemplateQueryWriter(),
        embedder=FakeEmbedder(),
        reranker=reranker or PassThroughReranker(),
        checker=checker(judge),
        limits=limits or Limits(ideas=2, candidates=20, batch=4, keep=4),
    )


def dinner(**inputs):
    # One day, so the planner keeps its usual number: four, in these tests.
    return PlanInputs(**{"meal_types": ["dinner"], "plan_days": 1} | inputs)


def bowls(*numbers):
    return [f"Rice bowl {n}" for n in numbers]


def names(result, meal_type="dinner"):
    return [meal.recipe.name for meal in result.meals[meal_type]]


# ---------- diet rules ----------------------------------------------------


def test_diet_styles_are_matched_however_they_are_typed():
    rules, unknown = split_styles(["Vegetarian", "low-carb", "Gluten-Free", "keto"])
    assert [rule.style for rule in rules] == ["vegetarian", "low carb", "gluten free"]
    assert unknown == ["keto"]


@pytest.mark.parametrize(
    ("name", "groups"),
    [
        ("chicken broth", {"poultry"}),
        ("vegetable broth", set()),
        ("vegetarian bacon", set()),
        ("turkey bacon", {"poultry"}),
        ("salmon steak", {"fish"}),
        ("celery rib", set()),
        ("red wine vinegar", set()),
        ("white wine", {"alcohol"}),
        ("goat cheese", {"milk"}),
        ("honeydew melon", set()),
    ],
)
def test_ingredients_fall_into_diet_groups(name, groups):
    assert BOOK.groups(name) == groups


def test_a_diet_names_the_ingredients_that_break_it():
    assert BOOK.broken(RULES["vegetarian"], ["rice", "bacon bit", "fish sauce"]) == [
        "bacon bit",
        "fish sauce",
    ]
    assert BOOK.broken(RULES["vegan"], ["rice", "honey", "egg"]) == ["egg", "honey"]
    assert BOOK.broken(RULES["pescatarian"], ["salmon", "shrimp", "rice"]) == []


def test_kosher_keeps_meat_and_dairy_apart():
    assert BOOK.broken(RULES["kosher"], ["ground beef", "rice"]) == []
    assert BOOK.broken(RULES["kosher"], ["ground beef", "cheddar cheese"]) == [
        "cheddar cheese",
        "ground beef",
    ]


# ---------- search filter -------------------------------------------------


def pantry_of(*points):
    return Pantry(MATCHER, BOOK, {n for p in points for n in p["payload"]["ingredients"]})


def test_filter_leaves_out_allergens_served_meals_and_what_is_not_a_meal():
    search = pantry_of(CHEESY, CHICKEN).filter(
        "dinner", household=household("milk"), rules=[], served=[7, 7, 3], low_carb_share=0.26
    )
    assert {"key": "ingredients", "match": {"any": ["cheddar cheese"]}} in search["must_not"]
    assert {"has_id": [3, 7]} in search["must_not"]
    assert {"key": "is_component", "match": {"value": True}} in search["must_not"]
    categories = next(c for c in search["must_not"] if c.get("key") == "category")
    assert "Dessert" in categories["match"]["any"]
    assert search["must"] == []


def test_filter_for_diets():
    rules, _ = split_styles(["vegetarian", "low carb", "kosher"])
    search = pantry_of(CHEESY, CHICKEN).filter(
        "dinner", household=household(), rules=rules, served=[], low_carb_share=0.26
    )
    assert search["must"] == [{"key": "carb_pct", "range": {"lte": 0.26}}]
    assert {"key": "ingredients", "match": {"any": ["chicken breast"]}} in search["must_not"]
    # Kosher: not a recipe with both meat and dairy.
    assert {
        "must": [
            {"key": "ingredients", "match": {"any": ["chicken breast"]}},
            {"key": "ingredients", "match": {"any": ["cheddar cheese"]}},
        ]
    } in search["must_not"]


def test_breakfast_may_be_a_bread_but_dinner_may_not():
    pantry = pantry_of(CHEESY)
    kinds = {
        meal: next(
            c
            for c in pantry.filter(
                meal, household=household(), rules=[], served=[], low_carb_share=0.26
            )["must_not"]
            if c.get("key") == "category"
        )["match"]["any"]
        for meal in ("breakfast", "dinner")
    }
    assert "Quick Breads" in kinds["dinner"] and "Quick Breads" not in kinds["breakfast"]


# ---------- query writer --------------------------------------------------


def test_search_text_is_laid_out_like_an_embedded_recipe():
    text = card("Lentil soup", "Stew", ["Indian", "Lentil"], ["lentil", "carrot"])
    assert text == "Lentil soup. Stew. Tags: Indian, Lentil. Ingredients: lentil, carrot."


async def test_template_writer_mixes_in_what_the_household_likes():
    inputs = PlanInputs(liked_foods=["mushroom"], liked_cuisines=["thai"], household_size=4)
    query = await TemplateQueryWriter().write("dinner", inputs, 4)
    assert query.source == "template" and len(query.ideas) == 4
    assert all("mushroom" in idea and "Thai" in idea for idea in query.ideas)
    assert query.rerank_query.startswith("A dinner for 4 people.")


async def test_model_writes_the_searches():
    model = FakeModel(dishes("Lentil curry", "Bean tacos", "Fried rice"))
    inputs = PlanInputs(common_allergens=["tree_nut"], liked_foods=["lentil"])
    query = await LlmQueryWriter(model).write("lunch", inputs, 2)
    assert query.source == "model"
    assert query.ideas == [
        "Lentil curry. Vegetable. Ingredients: rice.",
        "Bean tacos. Vegetable. Ingredients: rice.",
    ]
    # What the user typed reaches the model as data, never in the instructions.
    system, (message,) = model.requests[0]
    sent = json.loads(message.content)
    assert sent["must_avoid"] == ["tree nut"] and sent["liked_foods"] == ["lentil"]
    assert "lentil" not in system


async def test_model_is_asked_again_when_it_does_not_call_the_tool():
    model = FakeModel(AssistantMessage("Here are some ideas!"), dishes("Lentil curry", "Tacos"))
    query = await LlmQueryWriter(model).write("dinner", PlanInputs(), 6)
    assert query.source == "model" and len(model.requests) == 2


@pytest.mark.parametrize(
    "answers",
    [[MODEL_DOWN], [AssistantMessage("no"), AssistantMessage("still no")], [dishes("One")] * 2],
    ids=["model down", "never calls the tool", "too few dishes"],
)
async def test_template_stands_in_when_the_model_fails(answers):
    query = await LlmQueryWriter(FakeModel(*answers)).write("dinner", PlanInputs(), 6)
    assert query.source == "template" and len(query.ideas) == 6


# ---------- safety check --------------------------------------------------


async def test_reference_file_rules_out_an_ingredient_without_asking_jev():
    judge = FakeJudge()
    verdict = await checker(judge).check(card_of(CHEESY), household("milk"), [])
    assert not verdict.safe and judge.asked == []
    assert {
        (hit["group"], hit["item"], hit["where"]) for hit in verdict.compliance["reference"]
    } == {("milk", "cheddar cheese", "ingredient")}


async def test_reference_file_reads_the_raw_names_too():
    # Normalized to "topping", written as a milk product.
    point = recipe(60, "Sundae", ["topping"], raw=["whipped cream topping"])
    assert not (await checker().check(card_of(point), household("milk"), [])).safe


async def test_allergen_in_the_steps_rules_a_recipe_out():
    verdict = await checker().check(card_of(STEPS), household("milk"), [])
    (hit,) = verdict.compliance["reference"]
    assert not verdict.safe
    assert (hit["phrase"], hit["where"]) == ("butter", "step")


async def test_cooking_words_in_the_steps_do_not_rule_a_recipe_out():
    point = recipe(61, "Rice balls", ["rice"], ["Roll into balls.", "Wrap and chill."])
    judge = FakeJudge()
    verdict = await checker(judge).check(card_of(point), household("gluten"), [])
    assert verdict.safe
    # Jev is told about them all the same.
    assert {note["word"] for note in verdict.compliance["reference"]["notes"]} == {"roll", "wrap"}


async def test_jev_rules_out_what_the_word_list_misses():
    judge = FakeJudge({"allergen:milk": ["dream whip"]})
    verdict = await checker(judge).check(card_of(BRAND), household("milk", "egg"), [])
    assert not verdict.safe
    checks = verdict.compliance["checks"]
    assert checks["allergen:milk"] == {"pass": False, "probability": 0.95, "limit": 0.2}
    assert checks["allergen:egg"]["pass"]


async def test_jev_is_asked_once_per_allergen_custom_term_and_diet():
    judge = FakeJudge()
    rules, _ = split_styles(["vegetarian", "low carb"])
    verdict = await checker(judge).check(
        card_of(PLAIN[0]), household("shellfish", "wheat", custom=["strawberry"]), rules
    )
    assert verdict.safe and verdict.compliance["model"] == "fake-jev"
    assert judge.asked == [
        (
            "Rice bowl 1",
            [
                "allergen:crustaceans",
                "allergen:gluten_cereals",
                "allergen:molluscs",
                "allergen:strawberry",
                "diet:vegetarian",
            ],
        )
    ]


async def test_a_diet_with_several_conditions_asks_them_one_by_one():
    judge = FakeJudge()
    rules, _ = split_styles(["kosher"])
    recipe_card = card_of(recipe(62, "Lemon salmon", ["salmon", "butter", "lemon"]))
    # Fish with butter is fine: it is meat with dairy that kosher keeps apart.
    assert (await checker(judge).check(recipe_card, household(), rules)).safe
    ((_, asked),) = judge.asked
    assert asked == ["diet:kosher 1", "diet:kosher 2", "diet:kosher 3"]


async def test_a_doubt_is_enough_for_an_allergen_but_not_for_a_diet():
    class Unsure(FakeJudge):
        async def ask(self, state, questions):
            return dict.fromkeys(questions, 0.3)

    rules, _ = split_styles(["vegetarian"])
    assert (await checker(Unsure()).check(card_of(PLAIN[0]), household(), rules)).safe
    assert not (await checker(Unsure()).check(card_of(PLAIN[0]), household("egg"), [])).safe


async def test_a_diet_is_checked_with_its_word_list_first():
    judge = FakeJudge()
    rules, _ = split_styles(["vegetarian"])
    verdict = await checker(judge).check(card_of(CHICKEN), household(), rules)
    assert not verdict.safe and judge.asked == []
    assert verdict.compliance["diets_broken"] == {"vegetarian": ["chicken breast"]}


async def test_nothing_to_avoid_means_nothing_to_ask():
    judge = FakeJudge()
    assert (await checker(judge).check(card_of(CHEESY), household(), [])).safe
    assert judge.asked == []


# ---------- pipeline ------------------------------------------------------


async def test_plan_keeps_the_best_checked_recipes_per_meal_type():
    qdrant = FakeQdrant([*PLAIN, SAUCE, CAKE])
    result = await planner(qdrant).plan(dinner())
    assert names(result) == bowls(1, 2, 3, 4)
    assert any("basic search" in warning for warning in result.warnings)


async def test_allergen_recipes_never_leave_the_search():
    qdrant = FakeQdrant([CHEESY, *PLAIN])
    result = await planner(qdrant).plan(dinner(common_allergens=["milk"]))
    assert "Cheesy rice" not in names(result)
    # Kept out by the filter, not found and then dropped.
    assert all(
        {"key": "ingredients", "match": {"any": ["cheddar cheese"]}} in f["must_not"]
        for f in qdrant.filters
    )


async def test_recipe_that_slips_through_is_caught_and_replaced():
    judge = FakeJudge({"allergen:milk": ["dream whip"]})
    qdrant = FakeQdrant([BRAND, STEPS, *PLAIN])
    result = await planner(qdrant, judge=judge).plan(dinner(common_allergens=["milk"]))
    # Two of the first four fail, so the next batch is checked to get to four.
    assert names(result) == bowls(1, 2, 3, 4)
    assert "Fluffy rice" in [name for name, _ in judge.asked]
    assert "Rice bowl 3" in [name for name, _ in judge.asked]


async def test_what_was_served_lately_is_left_out():
    served = [Served(recipe_id="1", title="Rice bowl 1"), Served(recipe_id="live-test", title="x")]
    result = await planner(FakeQdrant(PLAIN)).plan(dinner(recently_served=served))
    assert names(result) == bowls(2, 3, 4, 5)


async def test_diet_is_a_hard_rule():
    qdrant = FakeQdrant([CHICKEN, *PLAIN])
    result = await planner(qdrant).plan(dinner(diet_styles=["vegetarian"]))
    assert "Chicken rice" not in names(result)


async def test_a_diet_that_cannot_be_verified_says_so():
    result = await planner(FakeQdrant(PLAIN)).plan(dinner(diet_styles=["halal"]))
    assert any(warning.startswith("Halal:") for warning in result.warnings)


async def test_reranker_sets_the_order():
    class Backwards:
        async def rerank(self, query, documents):
            self.query, self.documents = query, documents
            return list(range(len(documents)))[::-1]

    reranker = Backwards()
    result = await planner(FakeQdrant(PLAIN), reranker=reranker).plan(dinner(household_size=2))
    assert names(result) == bowls(12, 11, 10, 9)
    assert reranker.query.startswith("A dinner for 2 people.")
    assert reranker.documents[0].startswith("Rice bowl 1. One Dish Meal. Ingredients: rice")


async def test_a_reranker_that_fails_or_answers_badly_is_not_fatal():
    class Broken:
        async def rerank(self, query, documents):
            raise RuntimeError("reranker is down")

    class Partial:
        async def rerank(self, query, documents):
            return [2, 2, 99, "x"]

    result = await planner(FakeQdrant(PLAIN), reranker=Broken()).plan(dinner())
    assert names(result) == bowls(1, 2, 3, 4)
    assert any("could not be reranked" in warning for warning in result.warnings)
    result = await planner(FakeQdrant(PLAIN), reranker=Partial()).plan(dinner())
    assert names(result) == bowls(3, 1, 2, 4)


async def test_a_recipe_is_suggested_for_one_meal_type_only():
    # Both searches find the same recipes. Dinner takes the next ones down.
    result = await planner(FakeQdrant(PLAIN)).plan(dinner(meal_types=["lunch", "dinner"]))
    assert names(result, "lunch") == bowls(1, 2, 3, 4)
    assert names(result, "dinner") == bowls(5, 6, 7, 8)


async def test_a_long_plan_keeps_more_than_the_usual_number():
    inputs = PlanInputs(meal_types=["dinner"], plan_days=8)
    result = await planner(FakeQdrant(PLAIN)).plan(inputs)
    assert len(names(result)) == 11


async def test_too_few_recipes_is_said_not_hidden():
    result = await planner(FakeQdrant(PLAIN[:2])).plan(dinner(plan_days=3))
    assert len(names(result)) == 2
    assert "Only 2 dinner recipes fit this household's rules, for a 3-day plan." in result.warnings


async def test_recipe_jev_could_not_answer_for_is_left_out():
    judge = FakeJudge(down_for=("Rice bowl 1",))
    result = await planner(FakeQdrant(PLAIN), judge=judge).plan(dinner(common_allergens=["egg"]))
    assert names(result) == bowls(2, 3, 4, 5)


async def test_no_plan_without_jev():
    judge = FakeJudge(down_for=("*",))
    with pytest.raises(PlannerUnavailable, match="allergen check"):
        await planner(FakeQdrant(PLAIN), judge=judge).plan(dinner(common_allergens=["egg"]))


async def test_no_plan_without_the_recipes():
    qdrant = FakeQdrant(PLAIN)
    qdrant.down = True
    with pytest.raises(PlannerUnavailable, match="recipes could not be read"):
        await planner(qdrant).plan(dinner())


# ---------- saving --------------------------------------------------------


async def test_best_options_are_set_on_days_and_the_rest_wait():
    result = await planner(FakeQdrant(PLAIN)).plan(PlanInputs(meal_types=["dinner"], plan_days=2))
    rows = option_rows(PlanInputs(meal_types=["dinner"], plan_days=2), result)
    assert [(r["rank"], r["day_index"], r["status"], r["is_headline"]) for r in rows[:3]] == [
        (1, 0, "shown", True),
        (2, 1, "shown", True),
        (3, None, "queued", False),
    ]
    assert all(r["allergen_safe"] and r["meal_type"] == "dinner" for r in rows)
    assert rows[0]["recipe_id"] == "1" and rows[0]["nutrition"]["calories"] == 400.0


# ---------- routes --------------------------------------------------------


def token(**claims):
    payload = {"sub": USER, "aud": "authenticated", "exp": int(time.time()) + 600} | claims
    return jwt.encode(payload, SECRET, algorithm="HS256")


@pytest.fixture
def store():
    return FakeMealStore(PlanInputs(common_allergens=["milk"], plan_days=2, meal_types=["dinner"]))


@pytest.fixture
def qdrant():
    return FakeQdrant([CHEESY, *PLAIN])


@pytest.fixture
async def client(store, qdrant):
    settings = Settings(
        _env_file=None,
        supabase_jwt_secret=SECRET,
        supabase_anon_key="anon",
        supabase_service_role_key="service",
    )
    app = create_app(settings)
    app.state.judge = FakeJudge()

    # Still asks for the signed-in user, so the real token check runs.
    def signed_in_store(user: CurrentUser):
        assert user.id == USER
        return store

    app.dependency_overrides |= {
        meals.get_meal_store: signed_in_store,
        meals.get_planner: lambda: planner(qdrant, judge=app.state.judge),
        meals.get_recipe_cards: qdrant.client,
    }
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api") as http:
        http.headers["Authorization"] = f"Bearer {token()}"
        http.app = app
        yield http


async def test_planning_needs_a_signed_in_user(client):
    response = await client.post("/api/meal-options", headers={"Authorization": ""})
    assert response.status_code == 401


async def test_plan_meals_route_saves_and_returns_the_options(client, store):
    response = await client.post("/api/meal-options")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "ready" and body["plan_days"] == 2
    options = body["meals"]["dinner"]
    # Two days, so two are set on days. The rest are alternatives.
    assert [(o["title"], o["day_index"], o["status"]) for o in options] == [
        ("Rice bowl 1", 0, "shown"),
        ("Rice bowl 2", 1, "shown"),
        ("Rice bowl 3", None, "queued"),
        ("Rice bowl 4", None, "queued"),
        ("Rice bowl 5", None, "queued"),
    ]
    assert options[0]["ingredients"] == ["rice", "carrot", "onion"]
    assert options[0]["compliance"]["checks"]["allergen:milk"]["pass"]
    session = store.sessions[body["session_id"]]
    assert session["status"] == "ready" and len(session["meal_options"]) == 5


async def test_request_can_change_the_plan_length_and_meals(client, store):
    body = {"plan_days": 1, "meal_types": ["lunch", "dinner"]}
    response = await client.post("/api/meal-options", json=body)
    assert response.status_code == 201
    assert set(response.json()["meals"]) == {"lunch", "dinner"}
    assert next(iter(store.sessions.values()))["overrides"] == body
    again = {"meal_types": ["lunch", "lunch"]}
    assert (await client.post("/api/meal-options", json=again)).status_code == 422


async def test_failed_check_fails_the_session_and_suggests_nothing(client, store):
    client.app.state.judge.down_for = ("*",)
    response = await client.post("/api/meal-options")
    assert response.status_code == 503
    (session,) = store.sessions.values()
    assert session["status"] == "failed" and session["meal_options"] == []
    assert "allergen check" in session["error_message"]


async def test_nothing_fits_is_an_answer_not_an_empty_plan(client, store, qdrant):
    qdrant.points = [CHEESY]
    response = await client.post("/api/meal-options")
    assert response.status_code == 422
    assert response.json()["detail"] == "No recipe fits this household's allergies and diet."
    assert next(iter(store.sessions.values()))["status"] == "failed"


async def test_saved_options_can_be_read_again(client):
    created = (await client.post("/api/meal-options")).json()
    response = await client.get(f"/api/meal-options/{created['session_id']}")
    assert response.status_code == 200
    assert response.json() == created | {"warnings": []}


async def test_someone_elses_or_missing_session_is_not_found(client):
    response = await client.get("/api/meal-options/00000000-0000-4000-8000-999999999999")
    assert response.status_code == 404
