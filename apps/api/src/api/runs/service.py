"""Runs the shopping agent for a grocery list and keeps the order row up to date."""

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Any

from api.agent.loop import run_shopping_agent
from api.agent.schemas import (
    ApprovalNeeded,
    Done,
    Event,
    RunFailed,
    ShoppingRequest,
    ToolCalled,
    ToolReturned,
)
from api.cart.schemas import CartItem
from api.cart.store import CartStore
from api.runs.data import GroceryItem, PaidLine, RunStatus, ShoppingData
from api.shopping.schemas import ListItem, PaidCheckout

logger = logging.getLogger(__name__)

# Grocery item names are typed by users and are shown to the model.
MAX_NAME_LENGTH = 80
SAVE_ATTEMPTS = 3


def _key(name: str) -> str:
    return name.strip().lower()


# Words that describe water or ice without making it something a store sells.
_TAP_WORDS = {"water", "boiling", "cold", "hot", "warm", "lukewarm", "cool", "iced", "tap"}
_ICE_WORDS = {"ice", "cube", "cubes"}


def _from_the_tap(name: str) -> bool:
    """Plain water or ice: "water", "boiling water", "ice cubes". The stores'
    search matches on single words, so "water" would buy canned tuna in water."""
    words = set(_key(name).replace("-", " ").split())
    if "water" in words:
        return words <= _TAP_WORDS | _ICE_WORDS
    return "ice" in words and words <= _ICE_WORDS


def shopping_items(
    items: list[GroceryItem], bought: set[str]
) -> tuple[list[ListItem], dict[str, str]]:
    """The grocery items still to buy, as the agent's shopping list, and the
    grocery item behind each name.

    Left out: items the user ticked as already at home, items an earlier run
    paid for, and plain water or ice. An item with no usable amount is bought as one pack and flagged, so
    it waits for the user's check. So is a name listed with two different units,
    because those amounts can't be added up.
    """
    groups: dict[str, list[GroceryItem]] = {}
    for item in items:
        if item.checked or item.id in bought or not _key(item.name):
            continue
        if _from_the_tap(item.name):
            continue
        groups.setdefault(_key(item.name), []).append(item)

    listed: list[ListItem] = []
    item_ids: dict[str, str] = {}
    for key, rows in groups.items():
        usable = [row for row in rows if row.quantity_estimate and row.quantity_estimate > 0]
        units = {(row.unit or "").strip().lower() for row in rows}
        known = len(usable) == len(rows) and len(units) == 1
        first = usable[0] if usable else rows[0]
        name = rows[0].name.strip()[:MAX_NAME_LENGTH]
        listed.append(
            ListItem(
                name=name,
                quantity=sum(row.quantity_estimate for row in rows) if known else 1,
                unit=(first.unit or "").strip() if known else "",
                assumed_quantity=not known,
            )
        )
        item_ids[_key(name)] = rows[0].id
    return listed, item_ids


def _paid_lines(
    payment: PaidCheckout, cart: dict[tuple[str, str], CartItem], item_ids: dict[str, str]
) -> list[PaidLine]:
    lines = []
    for order in payment.orders:
        for line in order.lines:
            item = cart.get((order.store, line.upc))
            replaced = item is not None and "out_of_stock_replacement" in item.hold_reasons
            lines.append(
                PaidLine(
                    store=order.store,
                    upc=line.upc,
                    store_order_id=order.order_id,
                    payment_reference=order.payment_reference,
                    product_name=line.name,
                    quantity=line.quantity,
                    unit_price_cents=line.unit_price_cents,
                    line_total_cents=line.line_total_cents,
                    for_ingredient=item.for_ingredient if item else None,
                    grocery_item_id=item_ids.get(_key(item.for_ingredient)) if item else None,
                    status="substituted" if replaced else "found",
                    substitution_note="A cheaper option was out of stock." if replaced else None,
                )
            )
    return lines


async def _save_payment(
    data: ShoppingData, order_id: str, payment: PaidCheckout, lines: list[PaidLine]
) -> bool:
    """A payment that went through must not be lost to a database hiccup."""
    for attempt in range(1, SAVE_ATTEMPTS + 1):
        try:
            await data.record_payment(order_id, payment, lines)
            return True
        except Exception:
            reference = payment.payment_reference
            logger.exception("Saving payment %s failed (try %s)", reference, attempt)
            await asyncio.sleep(attempt)
    # Last resort: the full payment in the server log.
    logger.error("PAID BUT NOT SAVED, order %s: %s", order_id, payment.model_dump_json())
    return False


async def _touch(data: ShoppingData, order_id: str) -> None:
    try:
        await data.touch_run(order_id)
    except Exception:
        logger.warning("Could not mark run %s as alive", order_id, exc_info=True)


async def recorded_run(
    request: ShoppingRequest,
    *,
    data: ShoppingData,
    order_id: str,
    cart_store: CartStore,
    item_ids: dict[str, str],
    **agent: Any,
) -> AsyncIterator[Event]:
    """The agent's events, unchanged, while the order row follows along: alive
    while tools run, placed as soon as a payment goes through, and closed with
    the summary at the end."""
    in_cart: dict[tuple[str, str], CartItem] = {}
    paid = False
    error: str | None = None
    done: Done | None = None
    try:
        async for event in run_shopping_agent(request, cart_store=cart_store, **agent):
            if isinstance(event, ToolCalled):
                await _touch(data, order_id)
                if event.name == "checkout":
                    # The tool starts after this event, so this is the cart being paid for.
                    in_cart = {(item.store, item.upc): item for item in await cart_store.list()}
            elif isinstance(event, ApprovalNeeded):
                await _touch(data, order_id)
            elif isinstance(event, ToolReturned) and event.name == "checkout" and event.ok:
                payment = PaidCheckout.model_validate(event.result)
                paid = True
                saved = await _save_payment(
                    data, order_id, payment, _paid_lines(payment, in_cart, item_ids)
                )
                yield event
                if not saved:
                    yield RunFailed(
                        message="The payment went through but the order could not be saved. "
                        f"Payment reference: {payment.payment_reference}"
                    )
                continue
            elif isinstance(event, RunFailed):
                error = event.message
            elif isinstance(event, Done):
                done = event
            yield event
    except Exception:
        logger.exception("Run %s stopped unexpectedly", order_id)
        error = "The run stopped unexpectedly."
        yield RunFailed(message=error)
    finally:
        status: RunStatus = "placed" if paid else "unpaid" if done and not error else "failed"
        if status == "failed" and error is None:
            error = "The run was interrupted."
        try:
            await data.finish_run(
                order_id,
                status=status,
                finish_reason=done.finish_reason if done else None,
                summary=done.summary.model_dump(mode="json") if done else None,
                error=error,
            )
        except Exception:
            logger.exception("Could not close run %s as %s", order_id, status)
