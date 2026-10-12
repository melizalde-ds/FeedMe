"""Machine-readable product feed: everything one store sells, in one document."""

from fastapi import APIRouter

from storefront.catalog.schemas import Feed
from storefront.deps import CatalogDep, StoreDep

router = APIRouter(tags=["feeds"])


@router.get("/stores/{slug}/feed.json")
def product_feed(store: StoreDep, catalog: CatalogDep) -> Feed:
    return Feed(store=store, items=catalog.listings(store.slug))
