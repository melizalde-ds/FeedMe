from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SizeUnit = Literal["oz", "fl oz", "lb", "count"]


class Store(BaseModel):
    model_config = ConfigDict(frozen=True)

    slug: str
    name: str
    blurb: str = ""
    delivery_fee_cents: int = Field(ge=0)
    # None means the delivery fee always applies.
    free_delivery_threshold_cents: int | None = Field(default=None, ge=0)
    order_minimum_cents: int = Field(ge=0)


class Product(BaseModel):
    model_config = ConfigDict(frozen=True)

    upc: str
    name: str
    brand: str
    category: str
    size_value: float = Field(gt=0)
    size_unit: SizeUnit
    # Same kind of item with the same attributes. Products that share a group but
    # not a UPC are "comparable", not identical.
    equivalence_group: str
    # Slug of the store that owns this store-brand item, or None for a national brand.
    store_brand: str | None = None


class Offer(BaseModel):
    model_config = ConfigDict(frozen=True)

    store: str
    upc: str
    price_cents: int = Field(gt=0)
    in_stock: bool
