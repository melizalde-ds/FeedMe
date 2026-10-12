"""Price comparison and basket planning. Plain code: the model never does the math."""

from dataclasses import dataclass
from itertools import combinations

from api.shopping.errors import ShoppingError
from api.shopping.index import PriceIndex
from api.shopping.schemas import (
    BasketOption,
    BasketPlan,
    Listing,
    ListItem,
    Pick,
    PlanLine,
    PriceRow,
    Store,
    StoreTotal,
)
from api.shopping.units import packs_needed, unit_price


class ShoppingList:
    def __init__(self, items: list[ListItem]) -> None:
        self.items = items
        self._by_name = {item.name.strip().lower(): item for item in items}

    def need(self, ingredient: str) -> ListItem:
        try:
            return self._by_name[ingredient.strip().lower()]
        except KeyError:
            raise ShoppingError(f"{ingredient!r} is not on the shopping list") from None


def _product(index: PriceIndex, upc: str) -> Listing:
    product = index.product(upc)
    if product is None:
        raise ShoppingError(f"No store sells a product with UPC {upc!r}")
    return product


def compare_prices(index: PriceIndex, upc: str) -> list[PriceRow]:
    """The same product and comparable ones at every store, cheapest per unit first."""
    reference = _product(index, upc)
    rows = []
    for item in index.group(reference.equivalence_group):
        cents, per = unit_price(item.price_cents, item.size.value, item.size.unit)
        rows.append(
            PriceRow(
                store=item.store,
                upc=item.upc,
                name=item.name,
                brand=item.brand,
                size=str(item.size),
                price_cents=item.price_cents,
                unit_price_cents=cents,
                per=per,
                in_stock=item.in_stock,
                store_brand=item.store_brand,
                match="exact" if item.upc == upc else "comparable",
            )
        )
    rows.sort(key=lambda row: (row.unit_price_cents, row.price_cents, row.store))
    return rows


@dataclass(frozen=True)
class Candidate:
    listing: Listing
    packs: int
    cost_cents: int


def candidates(index: PriceIndex, equivalence_group: str, need: ListItem) -> list[Candidate]:
    """Every way to buy this ingredient, in or out of stock, cheapest first."""
    found = []
    for item in index.group(equivalence_group):
        packs = packs_needed(need.quantity, need.unit, item.size.value, item.size.unit)
        found.append(Candidate(item, packs, packs * item.price_cents))
    found.sort(key=lambda c: (c.cost_cents, c.listing.store, c.listing.upc))
    return found


def cheaper_out_of_stock(options: list[Candidate], cost_cents: int) -> bool:
    return any(not c.listing.in_stock and c.cost_cents < cost_cents for c in options)


def store_totals(
    subtotals: dict[str, int], stores: dict[str, Store]
) -> tuple[list[StoreTotal], int]:
    """Adds each store's delivery fee to its subtotal."""
    totals = []
    for slug, subtotal in subtotals.items():
        store = stores[slug]
        threshold = store.free_delivery_threshold_cents
        free = threshold is not None and subtotal >= threshold
        fee = 0 if free else store.delivery_fee_cents
        totals.append(
            StoreTotal(
                store=slug,
                subtotal_cents=subtotal,
                delivery_fee_cents=fee,
                total_cents=subtotal + fee,
            )
        )
    return totals, sum(t.total_cents for t in totals)


def plan_basket(index: PriceIndex, picks: list[Pick], shopping_list: ShoppingList) -> BasketPlan:
    """The cheapest way to buy the picks across stores, and the best single store.

    Each ingredient goes to the cheapest store among those being used, and every
    combination of stores is tried. That is exact for the fees and minimums in the
    seed data, but it won't move an item to a dearer store just to reach a minimum.
    """
    if not picks:
        raise ShoppingError("plan_basket needs at least one item")

    # Per ingredient: the best in-stock buy at each store, and all options for the
    # out-of-stock check.
    best_at: dict[str, dict[str, Candidate]] = {}
    options_for: dict[str, list[Candidate]] = {}
    exact_upc: dict[str, str] = {}
    for pick in picks:
        need = shopping_list.need(pick.ingredient)
        reference = _product(index, pick.upc)
        options = candidates(index, reference.equivalence_group, need)
        options_for[need.name] = options
        exact_upc[need.name] = pick.upc
        per_store: dict[str, Candidate] = {}
        for option in options:
            if not option.listing.in_stock:
                continue
            current = per_store.get(option.listing.store)
            better = current is None or (
                option.cost_cents == current.cost_cents and option.listing.upc == pick.upc
            )
            if better:
                per_store[option.listing.store] = option
        best_at[need.name] = per_store

    def option_for(allowed: tuple[str, ...]) -> BasketOption | None:
        chosen: dict[str, Candidate] = {}
        for ingredient, per_store in best_at.items():
            available = [per_store[s] for s in allowed if s in per_store]
            if available:
                chosen[ingredient] = min(available, key=lambda c: c.cost_cents)
        subtotals: dict[str, int] = {}
        for candidate in chosen.values():
            slug = candidate.listing.store
            subtotals[slug] = subtotals.get(slug, 0) + candidate.cost_cents
        if any(subtotals[s] < index.stores[s].order_minimum_cents for s in subtotals):
            return None
        totals, total = store_totals(subtotals, index.stores)
        lines = [
            PlanLine(
                ingredient=ingredient,
                store=c.listing.store,
                upc=c.listing.upc,
                name=c.listing.name,
                brand=c.listing.brand,
                size=str(c.listing.size),
                packs=c.packs,
                price_cents=c.listing.price_cents,
                line_total_cents=c.cost_cents,
                match="exact" if c.listing.upc == exact_upc[ingredient] else "comparable",
                store_brand=c.listing.store_brand,
                replaces_out_of_stock=cheaper_out_of_stock(options_for[ingredient], c.cost_cents),
            )
            for ingredient, c in chosen.items()
        ]
        return BasketOption(
            lines=lines,
            stores=totals,
            total_cents=total,
            missing=[name for name in best_at if name not in chosen],
        )

    def best(store_sets) -> BasketOption:
        found = [option for allowed in store_sets if (option := option_for(allowed))]
        if not found:
            return BasketOption(lines=[], stores=[], total_cents=0, missing=list(best_at))
        # Cover the most ingredients, then cost the least, then use the fewest stores.
        return min(found, key=lambda o: (len(o.missing), o.total_cents, len(o.stores)))

    slugs = sorted({slug for per_store in best_at.values() for slug in per_store})
    every_set = [c for size in range(1, len(slugs) + 1) for c in combinations(slugs, size)]
    cheapest = best(every_set)
    single = best([(slug,) for slug in slugs])
    comparable = sorted(cheapest.missing) == sorted(single.missing)
    return BasketPlan(
        cheapest=cheapest,
        best_single_store=single,
        savings_cents=single.total_cents - cheapest.total_cents if comparable else None,
    )
