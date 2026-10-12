"""Pages for people. Store names are text only, and every page says the prices are demo prices."""

import json
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from storefront.catalog.models import Store
from storefront.catalog.schemas import Listing
from storefront.deps import CatalogDep, StoreDep, get_listing

router = APIRouter(default_response_class=HTMLResponse, include_in_schema=False)

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")
templates.env.filters["money"] = lambda cents: f"${cents / 100:,.2f}"
templates.env.filters["size"] = lambda size: f"{size.value:g} {size.unit}"


def product_json_ld(listing: Listing, store: Store) -> str:
    """schema.org Product data for the product page."""
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": listing.name,
        "gtin12": listing.upc,
        "brand": {"@type": "Brand", "name": listing.brand},
        "category": listing.category,
        "size": f"{listing.size.value:g} {listing.size.unit}",
        "offers": {
            "@type": "Offer",
            "price": f"{listing.price_cents / 100:.2f}",
            "priceCurrency": "USD",
            "availability": "https://schema.org/"
            + ("InStock" if listing.in_stock else "OutOfStock"),
            "seller": {"@type": "Organization", "name": store.name},
        },
    }
    # Keep "</script>" in the data from closing the tag early.
    return json.dumps(data, indent=2).replace("</", "<\\/")


@router.get("/")
def index(request: Request, catalog: CatalogDep):
    return templates.TemplateResponse(
        request, "index.html", {"stores": list(catalog.stores.values())}
    )


@router.get("/stores/{slug}")
def store_home(request: Request, store: StoreDep, catalog: CatalogDep):
    by_category: dict[str, list[Listing]] = {}
    for listing in sorted(catalog.listings(store.slug), key=lambda item: item.name):
        by_category.setdefault(listing.category, []).append(listing)
    return templates.TemplateResponse(
        request, "store.html", {"store": store, "by_category": dict(sorted(by_category.items()))}
    )


@router.get("/stores/{slug}/search")
def search(request: Request, store: StoreDep, catalog: CatalogDep, q: str = ""):
    results = catalog.search(store.slug, q) if q.strip() else []
    return templates.TemplateResponse(
        request, "search.html", {"store": store, "q": q, "results": results}
    )


@router.get("/stores/{slug}/products/{upc}")
def product(
    request: Request, store: StoreDep, listing: Annotated[Listing, Depends(get_listing)]
):
    return templates.TemplateResponse(
        request,
        "product.html",
        {"store": store, "item": listing, "json_ld": product_json_ld(listing, store)},
    )
