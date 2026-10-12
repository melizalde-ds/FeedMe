from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from storefront.catalog.models import Store
from storefront.catalog.service import Catalog, UnknownStore


def get_catalog(request: Request) -> Catalog:
    return request.app.state.catalog


CatalogDep = Annotated[Catalog, Depends(get_catalog)]


def get_store(slug: str, catalog: CatalogDep) -> Store:
    try:
        return catalog.store(slug)
    except UnknownStore:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown store {slug!r}") from None


StoreDep = Annotated[Store, Depends(get_store)]


def get_listing(upc: str, store: StoreDep, catalog: CatalogDep):
    listing = catalog.listing(store.slug, upc)
    if listing is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"{store.name} does not sell a product with UPC {upc!r}"
        )
    return listing
