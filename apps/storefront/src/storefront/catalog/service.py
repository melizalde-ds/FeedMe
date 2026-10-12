import re

from storefront.catalog.models import Offer, Product, Store
from storefront.catalog.schemas import Listing, Match, SearchHit, Size


def tokenize(text: str) -> set[str]:
    """Lowercase words with a plain plural trim, so "tomatoes" finds "tomato"."""
    words = set()
    for word in re.findall(r"[a-z0-9]+", text.lower()):
        if word.endswith("oes"):
            word = word[:-2]
        elif word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        words.add(word)
    return words


class UnknownStore(KeyError):
    pass


class Catalog:
    def __init__(
        self,
        stores: dict[str, Store],
        products: dict[str, Product],
        offers: dict[str, dict[str, Offer]],
    ) -> None:
        self.stores = stores
        self.products = products
        self._offers = offers
        self._words = {
            upc: tokenize(f"{p.name} {p.brand} {p.category}") for upc, p in products.items()
        }
        self._name_words = {upc: tokenize(p.name) for upc, p in products.items()}

    def store(self, slug: str) -> Store:
        try:
            return self.stores[slug]
        except KeyError:
            raise UnknownStore(slug) from None

    def _listing(self, offer: Offer) -> Listing:
        product = self.products[offer.upc]
        return Listing(
            upc=product.upc,
            name=product.name,
            brand=product.brand,
            category=product.category,
            size=Size(value=product.size_value, unit=product.size_unit),
            equivalence_group=product.equivalence_group,
            store_brand=product.store_brand is not None,
            store=offer.store,
            price_cents=offer.price_cents,
            in_stock=offer.in_stock,
            url=f"/stores/{offer.store}/products/{product.upc}",
        )

    def listings(self, slug: str) -> list[Listing]:
        self.store(slug)
        return [self._listing(offer) for offer in self._offers[slug].values()]

    def listing(self, slug: str, upc: str) -> Listing | None:
        self.store(slug)
        offer = self._offers[slug].get(upc)
        return self._listing(offer) if offer else None

    def search(self, slug: str, query: str, limit: int = 20) -> list[SearchHit]:
        """Keyword match on name, brand and category. Best matches first."""
        wanted = tokenize(query)
        hits = []
        for listing in self.listings(slug):
            matched = len(wanted & self._words[listing.upc])
            if not matched:
                continue
            name_words = self._name_words[listing.upc]
            closeness = round(len(wanted & name_words) / len(name_words), 3)
            match = Match(matched=matched, of=len(wanted), closeness=closeness)
            hits.append(SearchHit(**listing.model_dump(), match=match))
        hits.sort(key=lambda h: (-h.match.matched, -h.match.closeness, h.price_cents, h.upc))
        return hits[:limit]
