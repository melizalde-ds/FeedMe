"""What a shopping run reads and writes in Supabase.

Reads go through the user's own client, so row level security decides what they
can see. The cart and the orders are written with the service-role client, which
skips row level security: every such call sets or filters user_id itself.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

from postgrest import APIError
from pydantic import BaseModel
from supabase import AsyncClient

from api.cart.schemas import Mode
from api.cart.store import CartStore, SupabaseCartStore
from api.shopping.schemas import PaidCheckout

ACTIVE = ["pending", "shopping"]
# Orders that mean the items were really bought.
BOUGHT = ["placed", "delivered"]
UNIQUE_VIOLATION = "23505"

RunStatus = Literal["placed", "unpaid", "failed"]
MealType = Literal["breakfast", "lunch", "dinner", "snack"]

_ORDER_COLUMNS = (
    "id, plan_id, grocery_list_id, status, mode, budget_cents, subtotal_cents, "
    "delivery_fee_cents, total_cents, currency, payment_reference, finish_reason, "
    "error_message, placed_at, created_at, updated_at"
)


class GroceryItem(BaseModel):
    id: str
    name: str
    quantity_estimate: float | None = None
    unit: str | None = None
    checked: bool = False


class GroceryList(BaseModel):
    id: str
    plan_id: str
    # The plan's own budget, in cents. None when the plan has none.
    budget_cents: int | None
    items: list[GroceryItem]


class PlannedMeal(BaseModel):
    """A recipe in one slot of a plan, as saved in meal_plan_slots."""

    recipe_id: str
    title: str
    day_index: int
    meal_type: MealType
    servings: int | None = None
    image_url: str | None = None
    ingredients: list[str]


class PaidLine(BaseModel):
    """One product a store sold, as saved in order_items."""

    store: str
    upc: str
    store_order_id: str
    payment_reference: str
    product_name: str
    quantity: int
    unit_price_cents: int
    line_total_cents: int
    for_ingredient: str | None = None
    grocery_item_id: str | None = None
    status: Literal["found", "substituted"] = "found"
    substitution_note: str | None = None


class RunInProgress(Exception):
    """The grocery list already has a run that hasn't finished."""


class ShoppingData(Protocol):
    async def grocery_list(self, list_id: str) -> GroceryList | None:
        """The user's list with its items, or None if they have no such list."""
        ...

    async def save_plan(
        self, meals: list[PlannedMeal], *, household_size: int, budget_cents: int | None
    ) -> str:
        """Saves the meals as a new plan and builds its grocery list, with one
        pack of each ingredient. Returns the list's id. The meals are stored as
        allergen-safe, so only pass recipes that passed the allergen check."""
        ...

    async def shopping_mode(self) -> Mode: ...

    async def auto_buy(self) -> bool:
        """Whether the user asked to have the agent buy without being asked each time."""
        ...

    async def set_auto_buy(self, on: bool) -> None: ...

    async def bought_item_ids(self, list_id: str) -> set[str]:
        """Grocery items of this list that an earlier run already paid for."""
        ...

    def cart(self, list_id: str) -> CartStore: ...

    async def has_active_run(self, list_id: str) -> bool: ...

    async def start_run(
        self, grocery: GroceryList, mode: Mode, budget_cents: int | None, stale_after: float
    ) -> str:
        """Opens the order row for a run and returns its id. Raises RunInProgress
        if the list has one already. A run with no sign of life for stale_after
        seconds is closed as failed first, so a crash can't block the list forever."""
        ...

    async def touch_run(self, order_id: str) -> None:
        """Shows the run is still alive."""
        ...

    async def record_payment(
        self, order_id: str, payment: PaidCheckout, lines: list[PaidLine]
    ) -> None:
        """Saves a payment that went through. Safe to call again for the same payment."""
        ...

    async def finish_run(
        self,
        order_id: str,
        *,
        status: RunStatus,
        finish_reason: str | None,
        summary: dict[str, Any] | None,
        error: str | None,
    ) -> None: ...

    async def orders(self) -> list[dict[str, Any]]: ...

    async def order(self, order_id: str) -> dict[str, Any] | None: ...


def _cents(dollars: float | None) -> int | None:
    return None if dollars is None else round(dollars * 100)


class SupabaseShoppingData:
    def __init__(self, user_db: AsyncClient, service_db: AsyncClient, user_id: str) -> None:
        self._user_db = user_db
        self._service_db = service_db
        self._user_id = user_id

    def _own_order(self, query, order_id: str):
        return query.eq("id", order_id).eq("user_id", self._user_id)

    async def grocery_list(self, list_id: str) -> GroceryList | None:
        res = await (
            self._user_db.table("grocery_lists")
            .select(
                "id, plan_id, meal_plans(budget), "
                "grocery_items(id, name, quantity_estimate, unit, checked)"
            )
            .eq("id", list_id)
            .order("name", foreign_table="grocery_items")
            .execute()
        )
        if not res.data:
            return None
        row = res.data[0]
        return GroceryList(
            id=row["id"],
            plan_id=row["plan_id"],
            budget_cents=_cents((row.get("meal_plans") or {}).get("budget")),
            items=row["grocery_items"],
        )

    async def save_plan(
        self, meals: list[PlannedMeal], *, household_size: int, budget_cents: int | None
    ) -> str:
        db = self._user_db
        user = {"user_id": self._user_id}
        session = await db.table("meal_option_sessions").insert(user | {"status": "ready"}).execute()
        session_id = session.data[0]["id"]
        plan_id = None
        try:
            # A slot has to point at a stored option for the same recipe.
            titles = {meal.recipe_id: meal.title for meal in meals}
            options = await (
                db.table("meal_options")
                .insert(
                    [
                        user
                        | {
                            "session_id": session_id,
                            "recipe_id": recipe_id,
                            "title": title,
                            "allergen_safe": True,
                            "rank": rank,
                            "status": "accepted",
                        }
                        for rank, (recipe_id, title) in enumerate(titles.items(), start=1)
                    ]
                )
                .execute()
            )
            option_ids = {row["recipe_id"]: row["id"] for row in options.data}
            plan = {
                "session_id": session_id,
                "num_days": max(meal.day_index for meal in meals) + 1,
                "household_size": household_size,
                "budget": None if budget_cents is None else budget_cents / 100,
            }
            plan_id = (await db.table("meal_plans").insert(user | plan).execute()).data[0]["id"]
            await (
                db.table("meal_plan_slots")
                .insert(
                    [
                        user
                        | meal.model_dump(exclude={"ingredients"})
                        | {
                            "plan_id": plan_id,
                            "option_id": option_ids[meal.recipe_id],
                            "ingredients": [{"name": name} for name in meal.ingredients],
                        }
                        for meal in meals
                    ]
                )
                .execute()
            )
            list_id = (await db.rpc("build_grocery_list", {"p_plan_id": plan_id}).execute()).data
            # The slots carry no amounts, which the list would hold for the user's
            # check as unknown. One pack of each is the rule for a recipe.
            await db.table("grocery_items").update({"quantity_estimate": 1}).eq(
                "list_id", list_id
            ).execute()
        except Exception:
            # Don't leave half a plan behind. Deleting these takes their rows along.
            if plan_id:
                await db.table("meal_plans").delete().eq("id", plan_id).execute()
            await db.table("meal_option_sessions").delete().eq("id", session_id).execute()
            raise
        return list_id

    async def shopping_mode(self) -> Mode:
        res = await self._user_db.table("preferences").select("shopping_mode").execute()
        return res.data[0]["shopping_mode"] if res.data else "manual"

    async def auto_buy(self) -> bool:
        res = await self._user_db.table("preferences").select("auto_buy").execute()
        return res.data[0]["auto_buy"] if res.data else False

    async def set_auto_buy(self, on: bool) -> None:
        # A new user has no preferences row yet. An existing row keeps everything else.
        await (
            self._user_db.table("preferences")
            .upsert({"user_id": self._user_id, "auto_buy": on}, on_conflict="user_id")
            .execute()
        )

    async def bought_item_ids(self, list_id: str) -> set[str]:
        res = await (
            self._user_db.table("order_items")
            .select("grocery_item_id, orders!inner(grocery_list_id, status)")
            .eq("orders.grocery_list_id", list_id)
            .in_("orders.status", BOUGHT)
            .not_.is_("grocery_item_id", "null")
            .execute()
        )
        return {row["grocery_item_id"] for row in res.data}

    def cart(self, list_id: str) -> CartStore:
        return SupabaseCartStore(self._service_db, self._user_id, list_id)

    async def has_active_run(self, list_id: str) -> bool:
        res = await (
            self._user_db.table("orders")
            .select("id")
            .eq("grocery_list_id", list_id)
            .in_("status", ACTIVE)
            .limit(1)
            .execute()
        )
        return bool(res.data)

    async def start_run(
        self, grocery: GroceryList, mode: Mode, budget_cents: int | None, stale_after: float
    ) -> str:
        orders = self._service_db.table("orders")
        cutoff = datetime.now(UTC) - timedelta(seconds=stale_after)
        await (
            orders.update({"status": "failed", "error_message": "The run was interrupted."})
            .eq("user_id", self._user_id)
            .in_("status", ACTIVE)
            .lt("updated_at", cutoff.isoformat())
            .execute()
        )
        row = {
            "user_id": self._user_id,
            "plan_id": grocery.plan_id,
            "grocery_list_id": grocery.id,
            "status": "shopping",
            "mode": mode,
            "budget_cents": budget_cents,
        }
        try:
            res = await orders.insert(row).execute()
        except APIError as exc:
            if exc.code == UNIQUE_VIOLATION:
                raise RunInProgress from exc
            raise
        return res.data[0]["id"]

    async def touch_run(self, order_id: str) -> None:
        # Any update moves updated_at, through the table's trigger.
        orders = self._service_db.table("orders")
        await self._own_order(orders.update({"status": "shopping"}), order_id).eq(
            "status", "shopping"
        ).execute()

    async def record_payment(
        self, order_id: str, payment: PaidCheckout, lines: list[PaidLine]
    ) -> None:
        rows = [
            line.model_dump() | {"order_id": order_id, "user_id": self._user_id} for line in lines
        ]
        await (
            self._service_db.table("order_items")
            .upsert(rows, on_conflict="store,store_order_id,upc", ignore_duplicates=True)
            .execute()
        )
        orders = self._service_db.table("orders")
        current = await self._own_order(orders.select("receipt"), order_id).execute()
        receipt = (current.data[0]["receipt"] if current.data else None) or []
        if all(p["payment_reference"] != payment.payment_reference for p in receipt):
            receipt.append(payment.model_dump())
        store_orders = [order for p in receipt for order in p["orders"]]
        update = {
            "status": "placed",
            "placed_at": datetime.now(UTC).isoformat(),
            "payment_reference": payment.payment_reference,
            "receipt": receipt,
            "subtotal_cents": sum(order["subtotal_cents"] for order in store_orders),
            "delivery_fee_cents": sum(order["delivery_fee_cents"] for order in store_orders),
            "total_cents": sum(order["total_cents"] for order in store_orders),
        }
        await self._own_order(orders.update(update), order_id).execute()

    async def finish_run(
        self,
        order_id: str,
        *,
        status: RunStatus,
        finish_reason: str | None,
        summary: dict[str, Any] | None,
        error: str | None,
    ) -> None:
        update = {
            "status": status,
            "finish_reason": finish_reason,
            "summary": summary,
            "error_message": error,
        }
        orders = self._service_db.table("orders")
        await self._own_order(orders.update(update), order_id).execute()

    async def orders(self) -> list[dict[str, Any]]:
        res = await (
            self._user_db.table("orders")
            .select(_ORDER_COLUMNS)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return res.data

    async def order(self, order_id: str) -> dict[str, Any] | None:
        res = await (
            self._user_db.table("orders")
            .select(f"{_ORDER_COLUMNS}, summary, order_items(*)")
            .eq("id", order_id)
            .execute()
        )
        return res.data[0] if res.data else None
