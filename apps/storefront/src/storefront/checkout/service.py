from storefront.catalog.models import Store
from storefront.catalog.service import Catalog
from storefront.checkout.schemas import (
    CheckoutQuote,
    CheckoutRequest,
    OrderLine,
    Problem,
    Quote,
    StoreBasket,
)

# Stripe's minimum for a card payment made with a shared payment token.
MIN_CHARGE_CENTS = 50


class CheckoutError(Exception):
    """The checkout can't go ahead. problems names each store that can't sell its part."""

    def __init__(self, detail: str, problems: list[Problem] | None = None) -> None:
        super().__init__(detail)
        self.problems = problems or []


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _store_quote(catalog: Catalog, store: Store, basket: StoreBasket) -> Quote:
    """Prices one store's basket from its own catalog. Raises ValueError with the
    reason when the store can't sell it."""
    upcs = [line.upc for line in basket.lines]
    if len(set(upcs)) != len(upcs):
        raise ValueError("Each product can appear only once; use quantity")

    lines = []
    for line in basket.lines:
        listing = catalog.listing(store.slug, line.upc)
        if listing is None:
            raise ValueError(f"{store.name} does not sell a product with UPC {line.upc!r}")
        if not listing.in_stock:
            raise ValueError(f"{listing.name} is out of stock at {store.name}")
        lines.append(
            OrderLine(
                upc=listing.upc,
                name=listing.name,
                brand=listing.brand,
                size=listing.size,
                quantity=line.quantity,
                unit_price_cents=listing.price_cents,
                line_total_cents=listing.price_cents * line.quantity,
            )
        )

    subtotal = sum(line.line_total_cents for line in lines)
    if subtotal < store.order_minimum_cents:
        raise ValueError(
            f"{store.name} has a {_money(store.order_minimum_cents)} order minimum; "
            f"this basket is {_money(subtotal)}"
        )
    threshold = store.free_delivery_threshold_cents
    free = threshold is not None and subtotal >= threshold
    fee = 0 if free else store.delivery_fee_cents
    return Quote(
        store=store.slug,
        lines=lines,
        subtotal_cents=subtotal,
        delivery_fee_cents=fee,
        total_cents=subtotal + fee,
    )


def build_quote(catalog: Catalog, request: CheckoutRequest) -> CheckoutQuote:
    """Prices every store's basket. Nothing the buyer sends sets a price.

    Each store applies its own stock, order minimum and delivery fee. If any store
    can't sell its part, the whole checkout is refused and every such store is
    named, so the buyer can leave those out and try again.
    """
    slugs = [basket.store for basket in request.orders]
    if len(set(slugs)) != len(slugs):
        raise CheckoutError("Each store can appear only once")

    quotes, problems = [], []
    for basket in request.orders:
        store = catalog.stores.get(basket.store)
        if store is None:
            problems.append(Problem(store=basket.store, detail="Unknown store"))
            continue
        try:
            quotes.append(_store_quote(catalog, store, basket))
        except ValueError as exc:
            problems.append(Problem(store=basket.store, detail=str(exc)))
    if problems:
        raise CheckoutError("Some stores can't sell their part of this basket", problems)

    total = sum(quote.total_cents for quote in quotes)
    if total < MIN_CHARGE_CENTS:
        raise CheckoutError(f"Card payments need a total of at least {_money(MIN_CHARGE_CENTS)}")
    return CheckoutQuote(stores=quotes, total_cents=total)
