"""In-memory stand-ins for what the meal planner calls: Qdrant, the embedding
model, the query model, Jev and Supabase."""

import json
from typing import Any

import httpx

from api.agent.providers.base import AssistantMessage, ProviderError, ToolCall
from api.meals.safety import JudgeUnavailable
from api.meals.schemas import PlanInputs
from api.meals.store import option_rows
from api.recipes.client import RecipeClient


def recipe(recipe_id, name, ingredients, steps=(), **payload):
    """A recipe as Qdrant stores it."""
    return {
        "id": recipe_id,
        "payload": {
            "name": name,
            "ingredients": ingredients,
            "ingredients_raw": payload.pop("raw", ingredients),
            "instructions": list(steps),
            "category": payload.pop("category", "One Dish Meal"),
            "keywords": payload.pop("keywords", []),
            "is_component": False,
            "has_alcohol": False,
            "carb_pct": 0.5,
            "total_min": 30,
            "servings": 4,
            "calories": 400.0,
            "image_url": None,
        }
        | payload,
    }


def _matches(condition: dict[str, Any], point: dict[str, Any]) -> bool:
    """Whether a point meets one Qdrant condition, for the kinds the planner sends."""
    if "has_id" in condition:
        return point["id"] in condition["has_id"]
    if "must" in condition or "must_not" in condition:
        return _passes(condition, point)
    value = point["payload"].get(condition["key"])
    if "range" in condition:
        return value is not None and value <= condition["range"]["lte"]
    match = condition["match"]
    values = value if isinstance(value, list) else [value]
    if "any" in match:
        return any(v in match["any"] for v in values)
    return match["value"] in values


def _passes(search_filter: dict[str, Any], point: dict[str, Any]) -> bool:
    return all(_matches(c, point) for c in search_filter.get("must", [])) and not any(
        _matches(c, point) for c in search_filter.get("must_not", [])
    )


class FakeQdrant:
    """Answers the three calls the planner makes. A search returns every recipe
    that passes the filter, in the order given, whatever the vector."""

    def __init__(self, points: list[dict[str, Any]]) -> None:
        self.points = points
        self.filters: list[dict[str, Any]] = []
        self.down = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("qdrant is down")
        body = json.loads(request.content)
        if request.url.path.endswith("/facet"):
            names = sorted({name for p in self.points for name in p["payload"]["ingredients"]})
            return httpx.Response(200, json={"result": {"hits": [{"value": n} for n in names]}})
        if request.url.path.endswith("/points/query/batch"):
            results = []
            for search in body["searches"]:
                self.filters.append(search["filter"])
                found = [p for p in self.points if _passes(search["filter"], p)]
                results.append({"points": found[: search["limit"]]})
            return httpx.Response(200, json={"result": results})
        found = [p for p in self.points if p["id"] in body["ids"]]
        return httpx.Response(200, json={"result": found})

    def client(self) -> RecipeClient:
        http = httpx.AsyncClient(transport=httpx.MockTransport(self), base_url="http://qdrant")
        return RecipeClient(http, "recipes")


class FakeEmbedder:
    def __init__(self) -> None:
        self.texts: list[str] = []

    async def embed(self, texts):
        self.texts += texts
        return [[float(len(text))] for text in texts]


class FakeJudge:
    """Says yes to a question when the recipe has one of the words given for it,
    the way Jev knows a brand name: FakeJudge({"allergen:milk": ["cool whip"]})."""

    model = "fake-jev"

    def __init__(self, knows: dict[str, list[str]] | None = None, down_for: tuple = ()) -> None:
        self.knows = knows or {}
        self.down_for = down_for  # recipe names it can't be asked about
        self.asked: list[tuple[str, list[str]]] = []

    async def ask(self, state, questions):
        name = state["recipe"]["name"]
        if "*" in self.down_for or name in self.down_for:
            raise JudgeUnavailable("jev is down")
        self.asked.append((name, sorted(questions)))
        text = json.dumps(state["recipe"]).lower()
        return {
            key: 0.95 if any(word in text for word in self.knows.get(key, [])) else 0.03
            for key in questions
        }


class FakeModel:
    """A query model that gives the answers it was handed, in turn."""

    def __init__(self, *answers) -> None:
        self.answers = list(answers)
        self.requests: list[tuple[str, list]] = []

    async def complete(self, system, messages, tools):
        self.requests.append((system, list(messages)))
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def dishes(*names):
    """The model's tool call for these dish names."""
    listed = [{"name": name, "category": "Vegetable", "ingredients": ["rice"]} for name in names]
    return AssistantMessage("", [ToolCall("t1", "submit_dishes", {"dishes": listed})])


MODEL_DOWN = ProviderError("bedrock is down")


class FakeMealStore:
    """Keeps one user's sessions and options the way the tables would."""

    def __init__(self, inputs: PlanInputs | None = None) -> None:
        self.saved = inputs or PlanInputs()
        self.sessions: dict[str, dict[str, Any]] = {}

    async def inputs(self, *, plan_days, meal_types):
        changes = {"plan_days": plan_days, "meal_types": meal_types}
        return self.saved.model_copy(update={k: v for k, v in changes.items() if v})

    async def open_session(self, inputs, overrides):
        session_id = f"00000000-0000-4000-8000-{len(self.sessions):012d}"
        self.sessions[session_id] = {
            "id": session_id,
            "status": "pending",
            "error_message": None,
            "overrides": overrides,
            "preferences_snapshot": {"plan_days": inputs.plan_days},
            "meal_options": [],
        }
        return session_id

    async def save_options(self, session_id, inputs, result):
        rows = [
            row | {"id": f"option-{i}", "session_id": session_id}
            for i, row in enumerate(option_rows(inputs, result))
        ]
        self.sessions[session_id] |= {"status": "ready", "meal_options": rows}
        return rows

    async def fail_session(self, session_id, message):
        self.sessions[session_id] |= {"status": "failed", "error_message": message}

    async def session(self, session_id):
        return self.sessions.get(session_id)
