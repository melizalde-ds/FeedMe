from typing import Literal

from pydantic import BaseModel

from api.shopping.schemas import StoreTotal

Mode = Literal["manual", "auto"]
Status = Literal["proposed", "in_cart"]

# Why an item waits for the user's check, even in auto mode.
HoldReason = Literal[
    "store_brand",  # a comparable store-brand item, not a national brand
    "out_of_stock_replacement",  # a cheaper option exists but is out of stock
    "over_budget",  # adding it would pass the weekly budget
    "unsure_match",  # the product may not be what the ingredient means
    "large_quantity",  # more packs than the per-item cap
    "unknown_quantity",  # the grocery list had no usable amount, so one pack was assumed
]


class CartItem(BaseModel):
    store: str
    upc: str
    name: str
    brand: str
    size: str
    unit_price_cents: int
    quantity: int
    for_ingredient: str
    status: Status
    hold_reasons: list[HoldReason] = []

    @property
    def line_total_cents(self) -> int:
        return self.unit_price_cents * self.quantity


class Totals(BaseModel):
    stores: list[StoreTotal]
    total_cents: int  # delivery fees included


class CartView(BaseModel):
    items: list[CartItem]
    in_cart: Totals
    # What the cart would cost if every proposed item were approved.
    if_all_approved: Totals
