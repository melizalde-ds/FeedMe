import httpx
import pytest
from link_fakes import storefront_app

from api.shopping.client import StorefrontClient
from api.shopping.index import PriceIndex
from api.shopping.schemas import Listing, Size, Store


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def storefront():
    """A client for the real storefront app and seed data, served in-process.
    It has no Stripe keys, whatever is in the developer's .env."""
    transport = httpx.ASGITransport(app=storefront_app(None))
    async with httpx.AsyncClient(transport=transport, base_url="http://storefront") as http:
        yield StorefrontClient(http)


def store(slug, fee=0, minimum=0, free_over=None):
    return Store(
        slug=slug,
        name=slug.title(),
        delivery_fee_cents=fee,
        free_delivery_threshold_cents=free_over,
        order_minimum_cents=minimum,
    )


def listing(
    store, upc, group, price, *, size=(1, "count"), in_stock=True, store_brand=False, name=None
):
    return Listing(
        upc=upc,
        name=name or group.replace("-", " ").title(),
        brand="Store Brand" if store_brand else "Brand",
        category="pantry",
        size=Size(value=size[0], unit=size[1]),
        equivalence_group=group,
        store_brand=store_brand,
        store=store,
        price_cents=price,
        in_stock=in_stock,
    )


def make_index(stores, listings):
    return PriceIndex(stores, listings)
