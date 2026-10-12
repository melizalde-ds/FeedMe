"""In-memory stand-ins for the Supabase side of a shopping run and for the
recipes in Qdrant."""

import json
import uuid
from typing import Any

import httpx

from api.cart.store import InMemoryCartStore
from api.recipes.client import RecipeClient
from api.runs.data import ACTIVE, BOUGHT, GroceryItem, GroceryList, RunInProgress

LIST_ID = "11111111-1111-4111-8111-111111111111"
PLAN_ID = "22222222-2222-4222-8222-222222222222"

# Recipes as Qdrant stores them. Both use olive oil.
RECIPES = {
    38: {
        "name": "Garlic penne",
        "ingredients": ["penne pasta", "garlic", "olive oil"],
        "servings": 4,
        "image_url": "https://example.com/penne.jpg",
    },
    42: {
        "name": "Eggs and spinach",
        "ingredients": ["eggs", "spinach", "olive oil"],
        "servings": None,
        "image_url": None,
    },
}
MEALS = [
    {"recipe_id": 38, "day_index": 0, "meal_type": "dinner"},
    {"recipe_id": 42, "day_index": 1, "meal_type": "breakfast"},
]


def qdrant(request):
    """Answers a lookup by id the way Qdrant does: only the points it has."""
    wanted = json.loads(request.content)["ids"]
    points = [{"id": i, "payload": RECIPES[i]} for i in wanted if i in RECIPES]
    return httpx.Response(200, json={"result": points})


def recipes_from(handler):
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://qdrant")
    return lambda: RecipeClient(http, "recipes")


def grocery_items(listed: list[dict[str, Any]]) -> list[GroceryItem]:
    """Grocery rows for [{name, quantity, unit}, ...], with ids item-0, item-1..."""
    return [
        GroceryItem(
            id=f"item-{i}", name=row["name"], quantity_estimate=row["quantity"], unit=row["unit"]
        )
        for i, row in enumerate(listed)
    ]


class FakeShoppingData:
    """Keeps one user's grocery list, cart and orders the way the tables would."""

    def __init__(self, items: list[GroceryItem], *, budget_cents=15_000, mode="manual"):
        self.grocery = GroceryList(
            id=LIST_ID, plan_id=PLAN_ID, budget_cents=budget_cents, items=items
        )
        self.mode = mode
        self.auto_buy_on = False
        self.cart_store = InMemoryCartStore()
        self.rows: dict[str, dict[str, Any]] = {}  # orders by id
        self.plans: list[list] = []  # the meals of each saved plan
        self.touches = 0
        # How many times saving a payment fails before it works.
        self.failing_saves = 0

    async def grocery_list(self, list_id):
        return self.grocery if list_id == LIST_ID else None

    async def save_plan(self, meals, *, household_size, budget_cents):
        """Replaces the list with one pack of each ingredient, merged by name as
        build_grocery_list does."""
        self.plans.append(meals)
        names = sorted({name.strip().lower() for meal in meals for name in meal.ingredients})
        items = [
            GroceryItem(id=f"item-{i}", name=name, quantity_estimate=1)
            for i, name in enumerate(names)
        ]
        self.grocery = GroceryList(
            id=LIST_ID, plan_id=PLAN_ID, budget_cents=budget_cents, items=items
        )
        return LIST_ID

    async def shopping_mode(self):
        return self.mode

    async def auto_buy(self):
        return self.auto_buy_on

    async def set_auto_buy(self, on):
        self.auto_buy_on = on

    async def bought_item_ids(self, list_id):
        return {
            line.grocery_item_id
            for row in self.rows.values()
            if row["status"] in BOUGHT
            for line in row["order_items"]
            if line.grocery_item_id
        }

    def cart(self, list_id):
        return self.cart_store

    async def has_active_run(self, list_id):
        return any(row["status"] in ACTIVE for row in self.rows.values())

    async def start_run(self, grocery, mode, budget_cents, stale_after):
        if await self.has_active_run(grocery.id):
            raise RunInProgress
        order_id = str(uuid.uuid4())
        self.rows[order_id] = {
            "id": order_id,
            "status": "shopping",
            "mode": mode,
            "budget_cents": budget_cents,
            "total_cents": 0,
            "payment_reference": None,
            "order_items": [],
        }
        return order_id

    async def touch_run(self, order_id):
        self.touches += 1

    async def record_payment(self, order_id, payment, lines):
        if self.failing_saves:
            self.failing_saves -= 1
            raise RuntimeError("database is down")
        row = self.rows[order_id]
        if row["payment_reference"] != payment.payment_reference:
            row["order_items"] += lines
            row["total_cents"] += payment.total_cents
        row |= {"status": "placed", "payment_reference": payment.payment_reference}

    async def finish_run(self, order_id, *, status, finish_reason, summary, error):
        self.rows[order_id] |= {
            "status": status,
            "finish_reason": finish_reason,
            "summary": summary,
            "error_message": error,
        }

    async def orders(self):
        return [{k: v for k, v in row.items() if k != "order_items"} for row in self.rows.values()]

    async def order(self, order_id):
        row = self.rows.get(order_id)
        if row is None:
            return None
        return row | {"order_items": [line.model_dump() for line in row["order_items"]]}
