"""Loads and validates the seed data. Any bad row stops the load."""

import csv
from pathlib import Path

import yaml
from pydantic import ValidationError

from storefront.catalog.models import Offer, Product, Store
from storefront.catalog.service import Catalog
from storefront.catalog.upc import upc_problem


class CatalogError(ValueError):
    pass


def _rows(path: Path):
    with path.open(newline="", encoding="utf-8") as f:
        # Line 1 is the header.
        yield from enumerate(csv.DictReader(f), start=2)


def _fail(path: Path, line: int, message: str) -> CatalogError:
    return CatalogError(f"{path.name}:{line}: {message}")


def load_catalog(data_dir: Path) -> Catalog:
    stores: dict[str, Store] = {}
    stores_path = data_dir / "stores.yaml"
    for i, raw in enumerate(yaml.safe_load(stores_path.read_text(encoding="utf-8")), start=1):
        try:
            store = Store.model_validate(raw)
        except ValidationError as exc:
            raise CatalogError(f"{stores_path.name}: store #{i}: {exc}") from exc
        if store.slug in stores:
            raise CatalogError(f"{stores_path.name}: duplicate store {store.slug!r}")
        stores[store.slug] = store

    products: dict[str, Product] = {}
    products_path = data_dir / "products.csv"
    for line, row in _rows(products_path):
        if problem := upc_problem(row["upc"]):
            raise _fail(products_path, line, f"UPC {row['upc']!r} {problem}")
        try:
            product = Product.model_validate(row | {"store_brand": row["store_brand"] or None})
        except ValidationError as exc:
            raise _fail(products_path, line, str(exc)) from exc
        if product.upc in products:
            raise _fail(products_path, line, f"duplicate UPC {product.upc}")
        if product.store_brand is not None and product.store_brand not in stores:
            raise _fail(products_path, line, f"unknown store {product.store_brand!r}")
        products[product.upc] = product

    offers: dict[str, dict[str, Offer]] = {slug: {} for slug in stores}
    offers_path = data_dir / "offers.csv"
    for line, row in _rows(offers_path):
        if row["in_stock"] not in ("true", "false"):
            raise _fail(offers_path, line, "in_stock must be true or false")
        try:
            offer = Offer.model_validate(row | {"in_stock": row["in_stock"] == "true"})
        except ValidationError as exc:
            raise _fail(offers_path, line, str(exc)) from exc
        if offer.store not in stores:
            raise _fail(offers_path, line, f"unknown store {offer.store!r}")
        product = products.get(offer.upc)
        if product is None:
            raise _fail(offers_path, line, f"unknown UPC {offer.upc}")
        if product.store_brand not in (None, offer.store):
            raise _fail(offers_path, line, f"{offer.upc} is a {product.store_brand} store brand")
        if offer.upc in offers[offer.store]:
            raise _fail(offers_path, line, f"duplicate offer for {offer.upc} at {offer.store}")
        offers[offer.store][offer.upc] = offer

    return Catalog(stores, products, offers)
