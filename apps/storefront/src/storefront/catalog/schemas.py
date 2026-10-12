from pydantic import BaseModel

from storefront.catalog.models import Store


class Size(BaseModel):
    value: float
    unit: str


class Listing(BaseModel):
    """One product as sold by one store."""

    upc: str
    name: str
    brand: str
    category: str
    size: Size
    equivalence_group: str
    store_brand: bool
    store: str
    price_cents: int
    in_stock: bool
    url: str


class Match(BaseModel):
    matched: int  # query words found in the product
    of: int  # query words in total
    closeness: float  # share of the product's own words that the query covered


class SearchHit(Listing):
    match: Match


class Feed(BaseModel):
    store: Store
    items: list[Listing]
