from typing import Literal

from pydantic import BaseModel, Field

from storefront.catalog.schemas import Size


class CheckoutLine(BaseModel):
    upc: str
    quantity: int = Field(ge=1, le=99)


class StoreBasket(BaseModel):
    store: str
    lines: list[CheckoutLine] = Field(min_length=1, max_length=100)


class CheckoutRequest(BaseModel):
    """One basket per store, all paid for together."""

    orders: list[StoreBasket] = Field(min_length=1, max_length=20)


class OrderLine(BaseModel):
    upc: str
    name: str
    brand: str
    size: Size
    quantity: int
    unit_price_cents: int
    line_total_cents: int


class Quote(BaseModel):
    """What one store will charge for its basket. Prices are the store's own."""

    store: str
    lines: list[OrderLine]
    subtotal_cents: int
    delivery_fee_cents: int
    total_cents: int


class CheckoutQuote(BaseModel):
    """Every store's quote, and the single amount that pays for all of them."""

    stores: list[Quote]
    total_cents: int
    currency: Literal["usd"] = "usd"


class Order(Quote):
    order_id: str
    status: Literal["paid"] = "paid"
    # The Stripe PaymentIntent that paid for it, shared by every order in the checkout.
    payment_reference: str


class PaidCheckout(BaseModel):
    orders: list[Order]
    total_cents: int
    currency: Literal["usd"] = "usd"
    payment_reference: str


class Problem(BaseModel):
    """Why one store can't sell its part of a checkout."""

    store: str
    detail: str
