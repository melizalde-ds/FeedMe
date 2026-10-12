"""Cart rules. The mode is enforced here, in code: the agent has one add tool in
both modes, and this decides whether a row is proposed or goes in the cart."""

import re

from pydantic import BaseModel

from api.cart.schemas import CartItem, CartView, HoldReason, Mode, Totals
from api.cart.store import CartStore
from api.shopping.errors import ShoppingError
from api.shopping.index import PriceIndex
from api.shopping.schemas import Store
from api.shopping.service import ShoppingList, candidates, cheaper_out_of_stock, store_totals

MAX_PACKS_PER_ITEM = 10


class AddLine(BaseModel):
    ingredient: str
    store: str
    upc: str
    # False when the agent isn't confident the product is what the ingredient means.
    sure: bool = True


def _totals(items: list[CartItem], stores: dict[str, Store]) -> Totals:
    subtotals: dict[str, int] = {}
    for item in items:
        subtotals[item.store] = subtotals.get(item.store, 0) + item.line_total_cents
    by_store, total = store_totals(subtotals, stores)
    return Totals(stores=by_store, total_cents=total)


def cart_view(items: list[CartItem], stores: dict[str, Store]) -> CartView:
    return CartView(
        items=items,
        in_cart=_totals([item for item in items if item.status == "in_cart"], stores),
        if_all_approved=_totals(items, stores),
    )


def effective_mode(mode: Mode, budget_cents: int | None) -> Mode:
    """Auto needs a budget to check against. Without one it falls back to manual."""
    return "manual" if budget_cents is None else mode


def _words(text: str) -> set[str]:
    return {word.removesuffix("s") for word in re.findall(r"[a-z0-9]+", text.lower())}


class CartService:
    def __init__(
        self,
        store: CartStore,
        index: PriceIndex,
        shopping_list: ShoppingList,
        mode: Mode,
        budget_cents: int | None,
    ) -> None:
        self._store = store
        self._index = index
        self._list = shopping_list
        self._mode = effective_mode(mode, budget_cents)
        self._budget_cents = budget_cents

    async def view(self) -> CartView:
        return cart_view(await self._store.list(), self._index.stores)

    async def remove(self, store: str, upc: str) -> None:
        if not await self._store.remove(store, upc):
            raise ShoppingError(f"The cart has no item {upc!r} from {store!r}")

    async def add(self, line: AddLine) -> CartItem:
        """Adds one product for an ingredient on the list. The pack count and the
        price come from here, never from the agent."""
        need = self._list.need(line.ingredient)
        listing = self._index.get(line.store, line.upc)
        if listing is None:
            raise ShoppingError(f"{line.store!r} does not sell a product with UPC {line.upc!r}")
        if not listing.in_stock:
            raise ShoppingError(f"{listing.name} is out of stock at {line.store}")

        options = candidates(self._index, listing.equivalence_group, need)
        key = (line.store, line.upc)
        bought = next(c for c in options if (c.listing.store, c.listing.upc) == key)

        reasons: list[HoldReason] = []
        if listing.store_brand:
            reasons.append("store_brand")
        if cheaper_out_of_stock(options, bought.cost_cents):
            reasons.append("out_of_stock_replacement")
        if not line.sure or not _words(need.name) & _words(f"{listing.name} {listing.category}"):
            reasons.append("unsure_match")
        if bought.packs > MAX_PACKS_PER_ITEM:
            reasons.append("large_quantity")
        if need.assumed_quantity:
            reasons.append("unknown_quantity")

        item = CartItem(
            store=listing.store,
            upc=listing.upc,
            name=listing.name,
            brand=listing.brand,
            size=str(listing.size),
            unit_price_cents=listing.price_cents,
            quantity=bought.packs,
            for_ingredient=need.name,
            status="proposed",
            hold_reasons=reasons,
        )
        if self._budget_cents is not None and await self._over_budget(item):
            item.hold_reasons.append("over_budget")
        if self._mode == "auto" and not item.hold_reasons:
            item.status = "in_cart"
        await self._store.upsert(item)
        return item

    async def _over_budget(self, item: CartItem) -> bool:
        # Everything not flagged over budget must fit in the budget together, so
        # approving the rest of the basket can never pass it.
        counted = [
            other
            for other in await self._store.list()
            if "over_budget" not in other.hold_reasons
            and (other.store, other.upc) != (item.store, item.upc)
        ]
        return _totals([*counted, item], self._index.stores).total_cents > self._budget_cents
