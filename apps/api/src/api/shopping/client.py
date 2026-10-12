"""HTTP client for the mock stores (apps/storefront). The agent only reaches the
stores through this, the way an outside agent would."""

import json

import httpx
from pydantic import TypeAdapter

from api.shopping.errors import CheckoutRefused, ShoppingError
from api.shopping.schemas import CheckoutQuote, Listing, SearchHit, Store

_stores = TypeAdapter(list[Store])
_hits = TypeAdapter(list[SearchHit])
_listings = TypeAdapter(list[Listing])


class StorefrontClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        # http must be created with base_url set to the storefront.
        self._http = http

    async def _get(self, path: str, **params: str | int):
        response = await self._http.get(path, params=params)
        response.raise_for_status()
        return response.json()

    async def list_stores(self) -> list[Store]:
        return _stores.validate_python(await self._get("/api/stores"))

    async def search(self, store: str, query: str, limit: int = 10) -> list[SearchHit]:
        data = await self._get(f"/api/stores/{store}/products", q=query, limit=limit)
        return _hits.validate_python(data)

    async def feed(self, store: str) -> list[Listing]:
        data = await self._get(f"/stores/{store}/feed.json")
        return _listings.validate_python(data["items"])

    def checkout_url(self) -> str:
        return str(self._http.base_url.join("/api/checkout"))

    @staticmethod
    def checkout_body(baskets: dict[str, list[tuple[str, int]]]) -> str:
        """The baskets, one per store, as the exact text the checkout is sent. The
        payment challenge is bound to these bytes, so the quote and the payment
        must send the same string."""
        orders = [
            {"store": store, "lines": [{"upc": upc, "quantity": qty} for upc, qty in lines]}
            for store, lines in baskets.items()
        ]
        return json.dumps({"orders": orders})

    async def quote(self, body: str) -> CheckoutQuote:
        """Asks what the baskets will cost, without paying. When every store can
        sell its part, the checkout answers 402 with the quote."""
        response = await self._http.post(
            "/api/checkout", content=body, headers={"Content-Type": "application/json"}
        )
        if response.status_code == httpx.codes.PAYMENT_REQUIRED:
            return CheckoutQuote.model_validate(response.json()["quote"])
        try:
            reply = response.json()
        except ValueError:
            reply = {}
        if response.status_code == httpx.codes.CONFLICT and reply.get("problems"):
            raise CheckoutRefused({p["store"]: p["detail"] for p in reply["problems"]})
        raise ShoppingError(
            f"The checkout was refused (HTTP {response.status_code}): "
            f"{reply.get('detail') or response.text[:200]}"
        )
