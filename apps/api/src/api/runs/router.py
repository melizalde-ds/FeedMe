"""HTTP routes for the buying agent: start a run for a grocery list or for chosen
recipes and follow it live, look at the cart it filled, read the orders it
placed, and keep the user's choice to have it buy without being asked."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated, Any, Self
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from api.agent.providers import get_provider
from api.agent.providers.base import ModelProvider, ProviderError
from api.agent.schemas import Event, ShoppingRequest
from api.auth import CurrentUser
from api.cart.schemas import CartView, Mode
from api.cart.service import cart_view
from api.db import ServiceDB, UserDB
from api.recipes.client import RecipeClient, RecipeNotFound, RecipesUnavailable
from api.runs.data import (
    GroceryList,
    MealType,
    PlannedMeal,
    RunInProgress,
    ShoppingData,
    SupabaseShoppingData,
)
from api.runs.service import recorded_run, shopping_items
from api.settings import Settings, get_settings
from api.shopping.client import StorefrontClient
from api.shopping.errors import ShoppingError
from api.wallet.service import Wallet

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["shopping"])

# Sent while a run is quiet, such as during a payment approval, so nothing
# between the server and the browser closes the stream as idle.
KEEPALIVE_SECONDS = 15.0
# How long past the approval window a silent run is still taken to be alive.
STALE_SLACK_SECONDS = 300.0


def get_shopping_data(user: CurrentUser, user_db: UserDB, service_db: ServiceDB) -> ShoppingData:
    return SupabaseShoppingData(user_db, service_db, user.id)


def get_storefront(request: Request) -> StorefrontClient:
    return StorefrontClient(request.app.state.storefront_http)


def get_recipes(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> RecipeClient:
    return RecipeClient(request.app.state.recipes_http, settings.qdrant_collection)


def get_wallet(request: Request) -> Wallet | None:
    """None when payments are turned off: a run then stops at the saved cart."""
    return request.app.state.wallet


def get_model(settings: Annotated[Settings, Depends(get_settings)]) -> ModelProvider:
    try:
        return get_provider(settings)
    except ProviderError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


Data = Annotated[ShoppingData, Depends(get_shopping_data)]
Storefront = Annotated[StorefrontClient, Depends(get_storefront)]


async def _own_list(list_id: UUID, data: Data) -> GroceryList:
    grocery = await data.grocery_list(str(list_id))
    if grocery is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Grocery list not found")
    return grocery


OwnList = Annotated[GroceryList, Depends(_own_list)]


class StartRun(BaseModel):
    # Leave out to use the mode saved in the user's preferences.
    mode: Mode | None = None
    # The user also chose "buy it for me every time": turns auto_buy on. False
    # leaves the saved choice as it is, so a run never turns it off.
    remember: bool = False


class AutoBuy(BaseModel):
    # True: the web app starts the agent without asking first.
    auto_buy: bool


class ChosenMeal(BaseModel):
    # The recipe's id in Qdrant.
    recipe_id: int = Field(ge=0)
    day_index: int = Field(ge=0, le=30)
    meal_type: MealType


class ShopForRecipes(StartRun):
    meals: list[ChosenMeal] = Field(min_length=1)
    household_size: int = Field(1, ge=1, le=20)
    # Auto mode needs a budget. Without one the run is manual.
    budget_cents: int | None = Field(None, ge=0)

    @model_validator(mode="after")
    def _one_meal_per_slot(self) -> Self:
        slots = [(meal.day_index, meal.meal_type) for meal in self.meals]
        if len(set(slots)) != len(slots):
            raise ValueError("Two meals are in the same slot of the plan")
        return self


def _sse(event_type: str, payload: str) -> str:
    return f"event: {event_type}\ndata: {payload}\n\n"


async def _pump(events: AsyncIterator[Event], queue: asyncio.Queue[Event | None]) -> None:
    try:
        async for event in events:
            queue.put_nowait(event)
    finally:
        queue.put_nowait(None)


async def _stream(
    created: dict[str, str], queue: asyncio.Queue[Event | None]
) -> AsyncIterator[str]:
    yield _sse("run_created", json.dumps({"type": "run_created"} | created))
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), KEEPALIVE_SECONDS)
        except TimeoutError:
            yield ": keepalive\n\n"
            continue
        if event is None:
            return
        yield _sse(event.type, event.model_dump_json())


RunStarter = Callable[[GroceryList, StartRun], Awaitable[StreamingResponse]]


def get_run_starter(
    request: Request,
    data: Data,
    storefront: Storefront,
    provider: Annotated[ModelProvider, Depends(get_model)],
    wallet: Annotated[Wallet | None, Depends(get_wallet)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> RunStarter:
    """The one way a run is started, for every route that starts one."""

    async def start(grocery: GroceryList, options: StartRun) -> StreamingResponse:
        items, item_ids = shopping_items(grocery.items, await data.bought_item_ids(grocery.id))
        if not items:
            raise HTTPException(status.HTTP_409_CONFLICT, "Nothing on this list is left to buy")
        shopping = ShoppingRequest(
            items=items,
            mode=options.mode or await data.shopping_mode(),
            budget_cents=grocery.budget_cents,
        )
        if options.remember:
            # Saved when the user confirms, not when the run succeeds: the choice
            # stands whatever happens to this run.
            await data.set_auto_buy(True)
        try:
            order_id = await data.start_run(
                grocery,
                shopping.mode,
                shopping.budget_cents,
                stale_after=settings.link_approval_timeout_seconds + STALE_SLACK_SECONDS,
            )
        except RunInProgress:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "A shopping run for this list is already in progress"
            ) from None

        cart = data.cart(grocery.id)
        try:
            # Each run starts from an empty cart, so nothing is bought twice.
            await cart.clear()
        except ShoppingError as exc:
            await data.finish_run(
                order_id, status="failed", finish_reason=None, summary=None, error=str(exc)
            )
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
        events = recorded_run(
            shopping,
            data=data,
            order_id=order_id,
            cart_store=cart,
            item_ids=item_ids,
            provider=provider,
            client=storefront,
            wallet=wallet,
            max_steps=settings.agent_max_steps,
            tool_timeout=settings.agent_tool_timeout_seconds,
        )

        # The run is its own task, not part of this request: a payment in flight
        # must still be recorded if the browser closes the stream.
        queue: asyncio.Queue[Event | None] = asyncio.Queue()
        runs: set[asyncio.Task] = request.app.state.runs
        task = asyncio.create_task(_pump(events, queue))
        runs.add(task)
        task.add_done_callback(runs.discard)
        return StreamingResponse(
            _stream({"order_id": order_id, "grocery_list_id": grocery.id}, queue),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return start


StartsRuns = Annotated[RunStarter, Depends(get_run_starter)]
_EVENT_STREAM = {200: {"content": {"text/event-stream": {}}}}


@router.post(
    "/grocery-lists/{list_id}/shopping-runs",
    response_class=StreamingResponse,
    responses=_EVENT_STREAM,
)
async def start_run(
    grocery: OwnList, start: StartsRuns, body: StartRun | None = None
) -> StreamingResponse:
    """Starts the buying agent on what is left to buy on the list, and streams
    its events as server-sent events. The run carries on if the client goes
    away; its result is on the order named in the first event."""
    return await start(grocery, body or StartRun())


@router.post("/shopping-runs", response_class=StreamingResponse, responses=_EVENT_STREAM)
async def shop_for_recipes(
    body: ShopForRecipes,
    data: Data,
    recipes: Annotated[RecipeClient, Depends(get_recipes)],
    start: StartsRuns,
) -> StreamingResponse:
    """Saves the chosen recipes as a meal plan, builds its grocery list from
    their ingredients and starts the buying agent on it, streaming the run like
    the route above. This is the step after the meals are chosen.

    The recipes are stored as allergen-safe without being checked here: only
    send ones that passed the allergen check."""
    try:
        found = await recipes.get(meal.recipe_id for meal in body.meals)
    except RecipeNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except RecipesUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    if not any(recipe.ingredients for recipe in found.values()):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "These recipes list no ingredients to buy"
        )
    meals = []
    for meal in body.meals:
        recipe = found[meal.recipe_id]
        meals.append(
            PlannedMeal(
                recipe_id=str(recipe.id),
                title=recipe.name,
                day_index=meal.day_index,
                meal_type=meal.meal_type,
                servings=recipe.servings,
                image_url=recipe.image_url,
                ingredients=recipe.ingredients,
            )
        )
    list_id = await data.save_plan(
        meals, household_size=body.household_size, budget_cents=body.budget_cents
    )
    return await start(await _own_list(UUID(list_id), data), body)


async def _view(grocery: GroceryList, data: ShoppingData, storefront: StorefrontClient) -> CartView:
    try:
        items = await data.cart(grocery.id).list()
        if not items:
            return cart_view([], {})
        # The stores' delivery fees are part of the totals.
        stores = {store.slug: store for store in await storefront.list_stores()}
    except (ShoppingError, httpx.HTTPError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return cart_view(items, stores)


async def _no_active_run(grocery: GroceryList, data: ShoppingData) -> None:
    if await data.has_active_run(grocery.id):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A shopping run is changing this cart. Try again when it ends"
        )


@router.get("/grocery-lists/{list_id}/cart")
async def get_cart(grocery: OwnList, data: Data, storefront: Storefront) -> CartView:
    return await _view(grocery, data, storefront)


@router.post("/grocery-lists/{list_id}/cart/approve")
async def approve_cart(grocery: OwnList, data: Data, storefront: Storefront) -> CartView:
    """Moves every proposed item into the cart."""
    await _no_active_run(grocery, data)
    try:
        await data.cart(grocery.id).approve_all()
    except ShoppingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return await _view(grocery, data, storefront)


@router.delete(
    "/grocery-lists/{list_id}/cart/items/{store}/{upc}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_cart_item(grocery: OwnList, store: str, upc: str, data: Data) -> None:
    await _no_active_run(grocery, data)
    try:
        removed = await data.cart(grocery.id).remove(store, upc)
    except ShoppingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That item is not in the cart")


@router.get("/auto-buy")
async def get_auto_buy(data: Data) -> AutoBuy:
    """Whether to start the buying agent without asking the user first. Off
    until the user turns it on, here or with "remember" when starting a run."""
    return AutoBuy(auto_buy=await data.auto_buy())


@router.put("/auto-buy")
async def set_auto_buy(body: AutoBuy, data: Data) -> AutoBuy:
    await data.set_auto_buy(body.auto_buy)
    return body


@router.get("/orders")
async def list_orders(data: Data) -> list[dict[str, Any]]:
    """The user's shopping runs, newest first. One row per run and payment."""
    return await data.orders()


@router.get("/orders/{order_id}")
async def get_order(order_id: UUID, data: Data) -> dict[str, Any]:
    """One run with the lines it bought and its final summary."""
    order = await data.order(str(order_id))
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order
