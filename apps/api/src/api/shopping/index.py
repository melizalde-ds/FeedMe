import asyncio
from typing import Self

from api.shopping.client import StorefrontClient
from api.shopping.schemas import Listing, Store


class PriceIndex:
    """Every store's prices, built from the stores' product feeds."""

    def __init__(self, stores: list[Store], listings: list[Listing]) -> None:
        self.stores = {store.slug: store for store in stores}
        self._by_offer = {(item.store, item.upc): item for item in listings}
        self._by_upc: dict[str, Listing] = {}
        self._by_group: dict[str, list[Listing]] = {}
        for item in listings:
            self._by_upc.setdefault(item.upc, item)
            self._by_group.setdefault(item.equivalence_group, []).append(item)

    @classmethod
    async def load(cls, client: StorefrontClient) -> Self:
        stores = await client.list_stores()
        feeds = await asyncio.gather(*(client.feed(store.slug) for store in stores))
        return cls(stores, [item for feed in feeds for item in feed])

    def get(self, store: str, upc: str) -> Listing | None:
        return self._by_offer.get((store, upc))

    def product(self, upc: str) -> Listing | None:
        """The product behind a UPC, from whichever store lists it."""
        return self._by_upc.get(upc)

    def group(self, equivalence_group: str) -> list[Listing]:
        return self._by_group.get(equivalence_group, [])
