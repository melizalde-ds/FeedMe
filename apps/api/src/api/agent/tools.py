"""The tools the model can call. Arguments are validated here, and anything the
model gets wrong comes back to it as an error it can read."""

import asyncio
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from api.agent.providers.base import ToolSpec
from api.agent.schemas import ApprovalNeeded, Event
from api.cart.schemas import CartItem
from api.cart.service import AddLine, CartService
from api.shopping.client import StorefrontClient
from api.shopping.errors import ShoppingError
from api.shopping.index import PriceIndex
from api.shopping.schemas import BasketPlan, CheckoutQuote, Order, Pick
from api.shopping.service import ShoppingList, compare_prices, plan_basket
from api.wallet.service import Wallet, pay_cart

MAX_SEARCH_RESULTS = 6
# search_list answers for the whole shopping list at once, so it gives fewer
# products per item and searches a few items at a time.
MAX_LIST_RESULTS = 3
LIST_SEARCHES_AT_ONCE = 8
LIST_SEARCH_TIMEOUT_SECONDS = 90.0


class ToolError(Exception):
    pass


class _NoArgs(BaseModel):
    pass


class _Search(BaseModel):
    query: str = Field(min_length=1, max_length=100)


class _Compare(BaseModel):
    upc: str


class _Plan(BaseModel):
    items: list[Pick] = Field(min_length=1)


class _Add(BaseModel):
    items: list[AddLine] = Field(min_length=1)


class _Remove(BaseModel):
    store: str
    upc: str


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required}


_STRING = {"type": "string"}

SPECS = [
    ToolSpec(
        "list_stores",
        "List the stores with their delivery fees and order minimums.",
        _object({}, []),
    ),
    ToolSpec(
        "search_list",
        "Search every store for every item on the shopping list, in one call. Gives "
        "each item's best matching products with their lowest price, and the items no "
        "store sells (not_sold). Call this first, once.",
        _object({}, []),
    ),
    ToolSpec(
        "search_products",
        "Search every store for products matching a few words, best match first. "
        "Each product lists the stores that sell it, with price and stock. search_list "
        "already does this for every item on the shopping list.",
        _object({"query": _STRING}, ["query"]),
    ),
    ToolSpec(
        "compare_prices",
        "Show a product and comparable ones at every store, cheapest per unit first.",
        _object({"upc": _STRING}, ["upc"]),
    ),
    ToolSpec(
        "plan_basket",
        "Work out the cheapest way to buy your picks across stores, with fees and order "
        "minimums included, and the best single store. Give one product per ingredient.",
        _object(
            {
                "items": {
                    "type": "array",
                    "items": _object({"ingredient": _STRING, "upc": _STRING}, ["ingredient", "upc"]),
                }
            },
            ["items"],
        ),
    ),
    ToolSpec(
        "add_to_cart",
        "Add products to the cart. The server sets the price and the number of packs. "
        "Set sure to false when the product may not be what the ingredient means.",
        _object(
            {
                "items": {
                    "type": "array",
                    "items": _object(
                        {
                            "ingredient": _STRING,
                            "store": _STRING,
                            "upc": _STRING,
                            "sure": {"type": "boolean"},
                        },
                        ["ingredient", "store", "upc", "sure"],
                    ),
                }
            },
            ["items"],
        ),
    ),
    ToolSpec(
        "remove_from_cart",
        "Remove one product from the cart.",
        _object({"store": _STRING, "upc": _STRING}, ["store", "upc"]),
    ),
    ToolSpec("view_cart", "Show the cart with totals per store.", _object({}, [])),
]

# Only offered when a wallet is connected.
CHECKOUT = ToolSpec(
    "checkout",
    "Pay for everything in the cart with one payment covering every store. The stores "
    "set the amount and the user approves it once on their phone, which can take a few "
    "minutes. A store that can't sell its part is left out and reported.",
    _object({}, []),
)

CART_TOOLS = {"add_to_cart", "remove_from_cart", "checkout"}


class Toolbox:
    def __init__(
        self,
        client: StorefrontClient,
        index: PriceIndex,
        shopping_list: ShoppingList,
        cart: CartService,
        wallet: Wallet | None = None,
        emit: Callable[[Event], None] = lambda event: None,
    ) -> None:
        self._client = client
        self._index = index
        self._list = shopping_list
        self._cart = cart
        self._wallet = wallet
        # Reports progress from inside a long tool call, such as a payment
        # waiting for approval.
        self._emit = emit
        self.specs = [*SPECS, CHECKOUT] if wallet else SPECS
        self.last_plan: BasketPlan | None = None
        self.orders: list[Order] = []
        self.purchased: list[CartItem] = []
        # True once payment has been tried, whether or not it went through.
        self.checkout_attempted = False
        self._handlers = {
            "list_stores": (_NoArgs, self._list_stores),
            "search_list": (_NoArgs, self._search_list),
            "search_products": (_Search, self._search_products),
            "compare_prices": (_Compare, self._compare_prices),
            "plan_basket": (_Plan, self._plan_basket),
            "add_to_cart": (_Add, self._add_to_cart),
            "remove_from_cart": (_Remove, self._remove_from_cart),
            "view_cart": (_NoArgs, self._view_cart),
        }
        if wallet:
            self._handlers["checkout"] = (_NoArgs, self._checkout)

    def timeout(self, name: str, default: float) -> float:
        """Paying waits on a person, so it gets the approval window plus slack.
        Searching for a whole list is many searches, so it gets longer too."""
        if name == "checkout" and self._wallet:
            return self._wallet.approval_timeout + 120
        if name == "search_list":
            return max(default, LIST_SEARCH_TIMEOUT_SECONDS)
        return default

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in self._handlers:
            raise ToolError(f"Unknown tool {name!r}. Tools: {', '.join(self._handlers)}")
        model, handler = self._handlers[name]
        try:
            args = model.model_validate(arguments)
        except ValidationError as exc:
            problems = "; ".join(
                f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()
            )
            raise ToolError(f"Invalid arguments for {name}: {problems}") from exc
        try:
            return await handler(args)
        except ShoppingError as exc:
            raise ToolError(str(exc)) from exc

    async def _list_stores(self, args: _NoArgs) -> dict[str, Any]:
        return {"stores": [store.model_dump() for store in self._index.stores.values()]}

    async def _search_list(self, args: _NoArgs) -> dict[str, Any]:
        gate = asyncio.Semaphore(LIST_SEARCHES_AT_ONCE)

        async def search(name: str) -> list[dict[str, Any]]:
            async with gate:
                return await self._search(name)

        names = [item.name for item in self._list.items]
        found = await asyncio.gather(*(search(name) for name in names))
        items, not_sold = [], []
        for name, products in zip(names, found, strict=True):
            if not products:
                not_sold.append(name)
                continue
            items.append(
                {
                    "ingredient": name,
                    # Without each store's offer: plan_basket prices the picks.
                    "products": [
                        {
                            "upc": product["upc"],
                            "name": product["name"],
                            "brand": product["brand"],
                            "size": product["size"],
                            "store_brand": product["store_brand"],
                            "match": product["match"],
                            "from_cents": min(o["price_cents"] for o in product["offers"]),
                            "in_stock": any(o["in_stock"] for o in product["offers"]),
                        }
                        for product in products[:MAX_LIST_RESULTS]
                    ],
                }
            )
        # Without this a model searches again for each item nothing was found
        # for, one turn at a time, and runs out of turns before it buys anything.
        return {
            "items": items,
            "not_sold": not_sold,
            "next": "Every store was searched for every item. No store sells the not_sold "
            "items: leave them out and do not search for them. Now pick one product for "
            "each of the other items and call plan_basket.",
        }

    async def _search_products(self, args: _Search) -> dict[str, Any]:
        return {"products": (await self._search(args.query))[:MAX_SEARCH_RESULTS]}

    async def _search(self, query: str) -> list[dict[str, Any]]:
        """Every store's products for a few words, best match first."""
        per_store = await asyncio.gather(
            *(self._client.search(slug, query) for slug in self._index.stores)
        )
        products: dict[str, dict[str, Any]] = {}
        for hit in (hit for hits in per_store for hit in hits):
            product = products.setdefault(
                hit.upc,
                {
                    "upc": hit.upc,
                    "name": hit.name,
                    "brand": hit.brand,
                    "size": str(hit.size),
                    "store_brand": hit.store_brand,
                    "match": hit.match.model_dump(),
                    "offers": [],
                },
            )
            product["offers"].append(
                {"store": hit.store, "price_cents": hit.price_cents, "in_stock": hit.in_stock}
            )
        # Best keyword match first, then national brands, then the lowest price.
        return sorted(
            products.values(),
            key=lambda p: (
                -p["match"]["matched"],
                -p["match"]["closeness"],
                p["store_brand"],
                min(offer["price_cents"] for offer in p["offers"]),
                p["upc"],
            ),
        )

    async def _compare_prices(self, args: _Compare) -> dict[str, Any]:
        return {"offers": [row.model_dump() for row in compare_prices(self._index, args.upc)]}

    async def _plan_basket(self, args: _Plan) -> dict[str, Any]:
        self.last_plan = plan_basket(self._index, args.items, self._list)
        return self.last_plan.model_dump()

    async def _add_to_cart(self, args: _Add) -> dict[str, Any]:
        added, rejected = [], []
        for line in args.items:
            try:
                added.append((await self._cart.add(line)).model_dump())
            except ShoppingError as exc:
                rejected.append({"ingredient": line.ingredient, "error": str(exc)})
        return {"added": added, "rejected": rejected}

    async def _remove_from_cart(self, args: _Remove) -> dict[str, Any]:
        await self._cart.remove(args.store, args.upc)
        return {"removed": True}

    async def _view_cart(self, args: _NoArgs) -> dict[str, Any]:
        return (await self._cart.view()).model_dump()

    async def _checkout(self, args: _NoArgs) -> dict[str, Any]:
        def approval_needed(quote: CheckoutQuote, approval_url: str | None) -> None:
            self._emit(
                ApprovalNeeded(
                    stores=[store.store for store in quote.stores],
                    total_cents=quote.total_cents,
                    approval_url=approval_url,
                )
            )

        self.checkout_attempted = True
        paid, items, left_out = await pay_cart(
            cart=self._cart,
            index=self._index,
            client=self._client,
            wallet=self._wallet,
            approval_needed=approval_needed,
        )
        self.orders.extend(paid.orders)
        self.purchased.extend(items)
        return {
            "paid": True,
            "total_cents": paid.total_cents,
            "payment_reference": paid.payment_reference,
            "orders": [order.model_dump() for order in paid.orders],
            # Stores left out of the payment, with the reason. Their items are still in the cart.
            "not_paid": left_out,
        }
