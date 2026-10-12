"""The agent run: a model picks tools, the tools run in code, and every step is
yielded as an event so a caller can stream it."""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from api.agent.providers.base import (
    Message,
    ModelProvider,
    ProviderError,
    ToolResult,
    ToolResults,
    UserMessage,
)
from api.agent.schemas import (
    AgentMessage,
    CartUpdated,
    Done,
    Event,
    Reminder,
    RunFailed,
    RunStarted,
    RunSummary,
    ShoppingRequest,
    ToolCalled,
    ToolReturned,
)
from api.agent.providers.base import ToolCall
from api.agent.tools import CART_TOOLS, Toolbox, ToolError
from api.cart.service import CartService, effective_mode
from api.cart.store import CartStore
from api.shopping.client import StorefrontClient
from api.shopping.index import PriceIndex
from api.shopping.service import ShoppingList
from api.wallet.service import Wallet

_STEPS = [
    "Call search_list once. It searches every store for every item on the list, so do "
    "not search item by item. Pick the product that best matches each item. Leave out "
    "the items it lists as not_sold, and any item whose products are a different food.",
    "Call plan_basket once with one pick per item.",
    'Add every line of the plan\'s "cheapest" option to the cart with add_to_cart.',
]
_PAY_STEP = (
    "Pay: call checkout once. It pays for the whole cart with a single payment, which "
    "the user approves on their phone. Report any store it says was not paid."
)
_FINAL_STEP = "Finish with a short summary: what you bought, and anything you could not find."
_RULES = """
Only use stores and UPCs that came from tool results. The server sets prices and
pack counts, and decides whether an item goes straight into the cart or waits for
the user's approval. Set sure to false when you are not confident a product is
what the item means. If a tool returns an error, read it and try another way.
"""


def system_prompt(can_pay: bool) -> str:
    steps = [*_STEPS, *([_PAY_STEP] if can_pay else []), _FINAL_STEP]
    numbered = "\n".join(f"{i}. {step}" for i, step in enumerate(steps, start=1))
    return (
        "You are a grocery shopping agent. The user's message is a JSON shopping list.\n\n"
        f"{numbered}\n{_RULES}"
    )


async def _summary(request: ShoppingRequest, cart: CartService, toolbox: Toolbox) -> RunSummary:
    view = await cart.view()
    matched = {item.for_ingredient for item in [*view.items, *toolbox.purchased]}
    single = toolbox.last_plan.best_single_store if toolbox.last_plan else None
    return RunSummary(
        cart=view,
        needs_check=[item for item in view.items if item.status == "proposed"],
        unmatched=[item.name for item in request.items if item.name not in matched],
        best_single_store=single.stores[0].store if single and single.stores else None,
        best_single_store_total_cents=single.total_cents if single and single.stores else None,
        savings_cents=toolbox.last_plan.savings_cents if toolbox.last_plan else None,
        orders=toolbox.orders,
        paid_total_cents=sum(order.total_cents for order in toolbox.orders),
    )


MAX_REMINDERS = 2


async def _unfinished(toolbox: Toolbox, cart: CartService, can_pay: bool) -> str | None:
    """What is still missing when the model says it is done, as a message to send
    it, or None when nothing is. Smaller models sometimes report success without
    having called the tool that does the work."""
    items = (await cart.view()).items
    planned = toolbox.last_plan is not None and toolbox.last_plan.cheapest.lines
    if planned and not items and not toolbox.purchased:
        return (
            "You have not saved anything yet: the cart is empty. Call add_to_cart now with "
            'every line of the "cheapest" option from your plan_basket result.'
        )
    # Only if payment was never tried. After a failed or declined payment, asking
    # again would send the user another approval request.
    if can_pay and items and not toolbox.checkout_attempted:
        return "The cart has not been paid for. Call checkout now."
    return None


async def _call_tool(
    toolbox: Toolbox, call: ToolCall, default_timeout: float
) -> tuple[dict[str, Any], bool]:
    """Runs one tool. Whatever goes wrong becomes a result the model can read."""
    timeout = toolbox.timeout(call.name, default_timeout)
    try:
        async with asyncio.timeout(timeout):
            return await toolbox.call(call.name, call.arguments), True
    except ToolError as exc:
        return {"error": str(exc)}, False
    except TimeoutError:
        return {"error": f"{call.name} timed out after {timeout:g}s"}, False
    except httpx.HTTPError as exc:
        return {"error": f"The stores could not be reached: {exc}"}, False


async def run_shopping_agent(
    request: ShoppingRequest,
    *,
    provider: ModelProvider,
    client: StorefrontClient,
    cart_store: CartStore,
    wallet: Wallet | None = None,
    max_steps: int = 25,
    tool_timeout: float = 10.0,
) -> AsyncIterator[Event]:
    mode = effective_mode(request.mode, request.budget_cents)
    yield RunStarted(
        mode=mode,
        requested_mode=request.mode,
        note=None if mode == request.mode else "Auto mode needs a weekly budget. Using manual.",
    )

    try:
        index = await PriceIndex.load(client)
    except httpx.HTTPError as exc:
        yield RunFailed(message=f"The stores could not be reached: {exc}")
        return

    shopping_list = ShoppingList(request.items)
    cart = CartService(cart_store, index, shopping_list, request.mode, request.budget_cents)
    # Events raised from inside a tool call, such as a payment waiting for approval.
    progress: asyncio.Queue[Event] = asyncio.Queue()
    toolbox = Toolbox(client, index, shopping_list, cart, wallet, progress.put_nowait)
    prompt = system_prompt(can_pay=wallet is not None)
    listed = [item.model_dump(exclude={"assumed_quantity"}) for item in request.items]
    messages: list[Message] = [UserMessage(json.dumps({"shopping_list": listed}))]

    finish_reason = "step_limit"
    reminders = 0
    for _ in range(max_steps):
        try:
            turn = await provider.complete(prompt, messages, toolbox.specs)
        except ProviderError as exc:
            yield RunFailed(message=str(exc))
            return
        messages.append(turn)
        if turn.text:
            yield AgentMessage(text=turn.text)
        if not turn.tool_calls:
            missing = await _unfinished(toolbox, cart, can_pay=wallet is not None)
            if missing is None:
                finish_reason = "completed"
                break
            if reminders == MAX_REMINDERS:
                finish_reason = "stopped_early"
                break
            reminders += 1
            messages.append(UserMessage(missing))
            yield Reminder(text=missing)
            continue

        results = []
        for call in turn.tool_calls:
            yield ToolCalled(name=call.name, arguments=call.arguments)
            # The tool runs as its own task so its progress can be streamed while
            # it is still going.
            running = asyncio.create_task(_call_tool(toolbox, call, tool_timeout))
            try:
                while not running.done():
                    waiting = asyncio.ensure_future(progress.get())
                    await asyncio.wait({running, waiting}, return_when=asyncio.FIRST_COMPLETED)
                    if waiting.done():
                        yield waiting.result()
                    else:
                        waiting.cancel()
                while not progress.empty():
                    yield progress.get_nowait()
            finally:
                running.cancel()
            result, ok = running.result()
            results.append(ToolResult(call.id, call.name, result, is_error=not ok))
            yield ToolReturned(name=call.name, ok=ok, result=result)
            if ok and call.name in CART_TOOLS:
                yield CartUpdated(cart=await cart.view())
        messages.append(ToolResults(results))

    yield Done(finish_reason=finish_reason, summary=await _summary(request, cart, toolbox))
