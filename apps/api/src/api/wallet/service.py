"""Paying for the cart with one payment that covers every store."""

import logging
from collections.abc import Callable
from typing import Protocol

from pydantic import ValidationError

from api.cart.schemas import CartItem
from api.cart.service import CartService
from api.shopping.client import StorefrontClient
from api.shopping.errors import CheckoutRefused, ShoppingError
from api.shopping.index import PriceIndex
from api.shopping.schemas import CheckoutQuote, PaidCheckout
from api.shopping.service import store_totals
from api.wallet.link import WalletError

logger = logging.getLogger(__name__)


class Wallet(Protocol):
    approval_timeout: float

    async def pay(
        self, url: str, body: str, context: str, approval_needed: Callable[[str | None], None]
    ) -> str: ...


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def purchase_context(store_names: list[str], quote: CheckoutQuote) -> str:
    """What the user reads in the Link app when approving. Link requires at least
    100 characters."""
    count = sum(line.quantity for store in quote.stores for line in store.lines)
    delivery = sum(store.delivery_fee_cents for store in quote.stores)
    return (
        f"Grocery order for the household's weekly meal plan, placed by the FeedMe shopping "
        f"agent at the customer's request. {count} item{'' if count == 1 else 's'} from "
        f"{', '.join(store_names)}. Total {_money(quote.total_cents)} including "
        f"{_money(delivery)} delivery."
    )


async def pay_cart(
    *,
    cart: CartService,
    index: PriceIndex,
    client: StorefrontClient,
    wallet: Wallet,
    approval_needed: Callable[[CheckoutQuote, str | None], None],
) -> tuple[PaidCheckout, list[CartItem], dict[str, str]]:
    """Pays for the whole cart with one payment, then takes the paid items out.

    A store that can't sell its part is left out, and its items stay in the cart;
    the rest is still paid in one go. Returns the paid checkout, the items it
    covered, and the stores left out with the reason for each.

    The stores price the baskets themselves. If that isn't what the cart expects,
    nothing is paid.
    """
    by_store: dict[str, list[CartItem]] = {}
    for item in (await cart.view()).items:
        by_store.setdefault(item.store, []).append(item)
    if not by_store:
        raise ShoppingError("The cart is empty")

    left_out: dict[str, str] = {}
    while True:
        baskets = {
            store: [(item.upc, item.quantity) for item in items]
            for store, items in by_store.items()
        }
        body = client.checkout_body(baskets)
        try:
            quote = await client.quote(body)
            break
        except CheckoutRefused as refused:
            dropped = {store: why for store, why in refused.problems.items() if store in by_store}
            if not dropped:
                raise
            left_out.update(dropped)
            for store in dropped:
                del by_store[store]
            if not by_store:
                raise ShoppingError(f"No store can sell its part of the cart. {refused}") from None

    subtotals = {
        store: sum(item.line_total_cents for item in items) for store, items in by_store.items()
    }
    expected_by_store, expected_total = store_totals(subtotals, index.stores)
    expected = {total.store: total.total_cents for total in expected_by_store}
    quoted = {store.store: store.total_cents for store in quote.stores}
    if quoted != expected or quote.total_cents != expected_total:
        raise ShoppingError(
            f"The stores asked for {_money(quote.total_cents)} but the cart says "
            f"{_money(expected_total)}. Nothing was paid."
        )

    names = [index.stores[store].name for store in by_store]
    try:
        reply = await wallet.pay(
            client.checkout_url(),
            body,
            purchase_context(names, quote),
            lambda approval_url: approval_needed(quote, approval_url),
        )
        paid = PaidCheckout.model_validate_json(reply)
    except WalletError as exc:
        raise ShoppingError(str(exc)) from exc
    except ValidationError as exc:
        raise ShoppingError(f"The payment went through but no orders came back: {exc}") from exc

    items = [item for store_items in by_store.values() for item in store_items]
    for item in items:
        try:
            await cart.remove(item.store, item.upc)
        except ShoppingError:
            # The payment went through. A row left in the cart must not turn
            # that into an error, or the model could try to pay a second time.
            logger.exception("Paid item %s at %s is still in the cart", item.upc, item.store)
    return paid, items, left_out
