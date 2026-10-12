from typing import Literal

from pydantic import BaseModel, Field

# --- What the storefront returns (apps/storefront) ---------------------------


class Store(BaseModel):
    slug: str
    name: str
    delivery_fee_cents: int
    free_delivery_threshold_cents: int | None = None
    order_minimum_cents: int


class Size(BaseModel):
    value: float
    unit: str

    def __str__(self) -> str:
        return f"{self.value:g} {self.unit}"


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


class Match(BaseModel):
    matched: int
    of: int
    closeness: float


class SearchHit(Listing):
    match: Match


class OrderLine(BaseModel):
    upc: str
    name: str
    quantity: int
    unit_price_cents: int
    line_total_cents: int


class Quote(BaseModel):
    """What one store will charge for its basket, priced by the store itself."""

    store: str
    lines: list[OrderLine]
    subtotal_cents: int
    delivery_fee_cents: int
    total_cents: int


class CheckoutQuote(BaseModel):
    """Every store's quote, and the single amount that pays for all of them."""

    stores: list[Quote]
    total_cents: int


class Order(Quote):
    order_id: str
    status: str
    # The Stripe PaymentIntent that paid for it, shared by every order in a checkout.
    payment_reference: str


class PaidCheckout(BaseModel):
    orders: list[Order]
    total_cents: int
    payment_reference: str


# --- Shopping ----------------------------------------------------------------


class ListItem(BaseModel):
    """One line of the shopping list: how much of an ingredient the recipes need."""

    name: str = Field(min_length=1)
    quantity: float = Field(gt=0)
    unit: str = ""
    # True when the grocery list had no usable amount and quantity is a guess.
    # The item is then held for the user's check.
    assumed_quantity: bool = False


class PriceRow(BaseModel):
    store: str
    upc: str
    name: str
    brand: str
    size: str
    price_cents: int
    unit_price_cents: float
    per: str
    in_stock: bool
    store_brand: bool
    # exact: the same UPC. comparable: a different product in the same group.
    match: Literal["exact", "comparable"]


class Pick(BaseModel):
    """The product the agent chose as the match for an ingredient."""

    ingredient: str
    upc: str


class PlanLine(BaseModel):
    ingredient: str
    store: str
    upc: str
    name: str
    brand: str
    size: str
    packs: int
    price_cents: int
    line_total_cents: int
    match: Literal["exact", "comparable"]
    store_brand: bool
    # A cheaper option exists but is out of stock.
    replaces_out_of_stock: bool


class StoreTotal(BaseModel):
    store: str
    subtotal_cents: int
    delivery_fee_cents: int
    total_cents: int


class BasketOption(BaseModel):
    lines: list[PlanLine]
    stores: list[StoreTotal]
    total_cents: int
    # Ingredients this option could not cover (out of stock, or under an order minimum).
    missing: list[str]


class BasketPlan(BaseModel):
    cheapest: BasketOption
    best_single_store: BasketOption
    # What the split saves over the best single store. None when they don't cover
    # the same ingredients, so the totals aren't comparable.
    savings_cents: int | None
