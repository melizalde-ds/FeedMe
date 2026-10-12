from typing import Protocol

import httpx
from postgrest import APIError
from supabase import AsyncClient

from api.cart.schemas import CartItem
from api.shopping.errors import ShoppingError


class CartStore(Protocol):
    """Where one cart is kept. Rows are unique per store and product."""

    async def list(self) -> list[CartItem]: ...

    async def upsert(self, item: CartItem) -> None: ...

    async def remove(self, store: str, upc: str) -> bool: ...

    async def approve_all(self) -> int:
        """Moves every proposed item into the cart. Returns how many moved."""
        ...

    async def clear(self) -> None: ...


class InMemoryCartStore:
    """Used by tests and the command-line demo."""

    def __init__(self) -> None:
        self._items: dict[tuple[str, str], CartItem] = {}

    async def list(self) -> list[CartItem]:
        return list(self._items.values())

    async def upsert(self, item: CartItem) -> None:
        self._items[(item.store, item.upc)] = item

    async def remove(self, store: str, upc: str) -> bool:
        return self._items.pop((store, upc), None) is not None

    async def approve_all(self) -> int:
        proposed = [item for item in self._items.values() if item.status == "proposed"]
        for item in proposed:
            self._items[(item.store, item.upc)] = item.model_copy(update={"status": "in_cart"})
        return len(proposed)

    async def clear(self) -> None:
        self._items.clear()


class SupabaseCartStore:
    """The cart of one grocery list, in the cart_items table.

    db must be the service-role client: clients can't write this table. Every
    call is narrowed to the user and the list, because that client skips row
    level security.
    """

    def __init__(self, db: AsyncClient, user_id: str, list_id: str) -> None:
        self._db = db
        self._owner = {"user_id": user_id, "list_id": list_id}

    def _rows(self, query):
        return query.eq("user_id", self._owner["user_id"]).eq("list_id", self._owner["list_id"])

    async def _run(self, query) -> list[dict]:
        # A ShoppingError reaches the model as a tool error it can read.
        try:
            return (await query.execute()).data
        except (APIError, httpx.HTTPError) as exc:
            raise ShoppingError(f"The cart could not be reached: {exc}") from exc

    async def list(self) -> list[CartItem]:
        query = self._rows(self._db.table("cart_items").select("*"))
        rows = await self._run(query.order("created_at").order("id"))
        return [CartItem.model_validate(row) for row in rows]

    async def upsert(self, item: CartItem) -> None:
        row = item.model_dump() | self._owner
        await self._run(self._db.table("cart_items").upsert(row, on_conflict="list_id,store,upc"))

    async def remove(self, store: str, upc: str) -> bool:
        query = self._rows(self._db.table("cart_items").delete())
        return bool(await self._run(query.eq("store", store).eq("upc", upc)))

    async def approve_all(self) -> int:
        query = self._rows(self._db.table("cart_items").update({"status": "in_cart"}))
        return len(await self._run(query.eq("status", "proposed")))

    async def clear(self) -> None:
        await self._run(self._rows(self._db.table("cart_items").delete()))
