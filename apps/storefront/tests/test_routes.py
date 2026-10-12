import json
import re


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_store_list_carries_fees_and_minimums(client):
    stores = {s["slug"]: s for s in client.get("/api/stores").json()}
    assert len(stores) == 6
    assert stores["quickcart"]["delivery_fee_cents"] == 599
    assert stores["bulkbarn-club"]["order_minimum_cents"] == 5000


def test_search_returns_listings_for_one_store(client):
    hits = client.get("/api/stores/redwood-market/products", params={"q": "eggs"}).json()
    assert {h["store"] for h in hits} == {"redwood-market"}
    assert {h["brand"] for h in hits} == {"Meadowbrook", "Corner & Co."}
    assert all(h["equivalence_group"] == "eggs-large" for h in hits)


def test_unknown_store_and_upc_are_rejected(client):
    assert client.get("/api/stores/nope").status_code == 404
    assert client.get("/api/stores/nope/products", params={"q": "eggs"}).status_code == 404
    assert client.get("/api/stores/staplemart/products/400000000000").status_code == 404
    assert client.get("/stores/staplemart/products/400000000000").status_code == 404


def test_product_lookup_by_upc(client):
    item = client.get("/api/stores/staplemart/products/410010000011").json()
    assert item["name"] == "Asparagus"
    assert item["price_cents"] == 399
    assert item["size"] == {"value": 1.0, "unit": "lb"}


def test_every_store_serves_pages_and_a_feed(client):
    for store in client.get("/api/stores").json():
        slug = store["slug"]
        home = client.get(f"/stores/{slug}")
        assert home.status_code == 200
        assert store["name"] in home.text
        assert "Demo prices" in home.text
        assert client.get(f"/stores/{slug}/search", params={"q": "oats"}).status_code == 200
        feed = client.get(f"/stores/{slug}/feed.json").json()
        assert feed["store"]["slug"] == slug
        assert feed["items"]
        assert {item["store"] for item in feed["items"]} == {slug}


def test_product_page_has_schema_org_data(client):
    page = client.get("/stores/staplemart/products/410010000011")
    assert page.status_code == 200
    block = re.search(r'<script type="application/ld\+json">(.*?)</script>', page.text, re.DOTALL)
    data = json.loads(block.group(1))
    assert data["@type"] == "Product"
    assert data["gtin12"] == "410010000011"
    assert data["offers"]["price"] == "3.99"
    assert data["offers"]["availability"] == "https://schema.org/InStock"
    assert data["offers"]["seller"]["name"] == "StapleMart"


def test_out_of_stock_shows_on_the_page_and_in_the_data(client):
    salmon = client.get("/api/stores/staplemart/products", params={"q": "salmon"}).json()[0]
    assert salmon["in_stock"] is False
    page = client.get(salmon["url"])
    assert "Out of stock" in page.text
    assert "https://schema.org/OutOfStock" in page.text
