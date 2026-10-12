"""JSON routes for agents."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from storefront.catalog.models import Store
from storefront.catalog.schemas import Listing, SearchHit
from storefront.deps import CatalogDep, StoreDep, get_listing

router = APIRouter(prefix="/api", tags=["agent api"])


@router.get("/stores")
def list_stores(catalog: CatalogDep) -> list[Store]:
    return list(catalog.stores.values())


@router.get("/stores/{slug}")
def get_store(store: StoreDep) -> Store:
    return store


@router.get("/stores/{slug}/products")
def search_products(
    store: StoreDep,
    catalog: CatalogDep,
    q: Annotated[str, Query(min_length=1, max_length=100)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[SearchHit]:
    return catalog.search(store.slug, q, limit)


@router.get("/stores/{slug}/products/{upc}")
def get_product(listing: Annotated[Listing, Depends(get_listing)]) -> Listing:
    return listing
