"""Builds .redesign/fixtures/shopping.json: a buying-agent cart and a finished
run's summary, from the mock stores' own seed catalog and prices
(apps/storefront/seed). Test harness only: the Playwright scripts play it back
in place of a live run, which needs Bedrock and a payment approved in Link.

    python3 .redesign/scripts/make_shopping_fixture.py
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "apps" / "storefront" / "seed"

products = {row["upc"]: row for row in csv.DictReader((SEED / "products.csv").open())}
prices = {(row["store"], row["upc"]): int(row["price_cents"]) for row in csv.DictReader((SEED / "offers.csv").open())}

# (store, upc, the ingredient it is for, status, hold reasons)
PICKS = [
    ("staplemart", "410020000278", "milk", "in_cart", []),
    ("staplemart", "410020000285", "butter", "in_cart", []),
    ("staplemart", "410010000202", "onion", "in_cart", []),
    ("redwood-market", "410040000319", "ground beef", "in_cart", []),
    # PennyWise does not sell these two, so the cheapest basket spans two stores.
    ("staplemart", "410020000247", "parmesan cheese", "in_cart", []),
    ("staplemart", "410010000134", "parsley", "in_cart", []),
    ("redwood-market", "420010000676", "egg", "proposed", ["store_brand"]),
    ("redwood-market", "410010000011", "asparagus", "proposed", ["unsure_match", "unknown_quantity"]),
]


def item(store, upc, ingredient, status, reasons):
    product = products[upc]
    return {
        "store": store,
        "upc": upc,
        "name": product["name"],
        "brand": product["brand"],
        "size": f'{product["size_value"]} {product["size_unit"]}',
        "for_ingredient": ingredient,
        "quantity": 1,
        "unit_price_cents": prices[(store, upc)],
        "status": status,
        "hold_reasons": reasons,
    }


def totals(items):
    stores = []
    for store in sorted({i["store"] for i in items}):
        subtotal = sum(i["unit_price_cents"] * i["quantity"] for i in items if i["store"] == store)
        stores.append({"store": store, "subtotal_cents": subtotal, "delivery_fee_cents": 0, "total_cents": subtotal})
    return {"stores": stores, "total_cents": sum(s["total_cents"] for s in stores)}


def cart(items):
    return {"items": items, "in_cart": totals([i for i in items if i["status"] == "in_cart"]), "if_all_approved": totals(items)}


# The agent's job is the cheapest basket, so each product it keeps comes from
# the store that sells it for least.
def cheapest(upc):
    return min((store for store, u in prices if u == upc), key=lambda store: (prices[(store, upc)], store))


items = [
    item(cheapest(upc) if status == "in_cart" else store, upc, ingredient, status, reasons)
    for store, upc, ingredient, status, reasons in PICKS
]
paid = [i for i in items if i["status"] == "in_cart"]
left = [i for i in items if i["status"] == "proposed"]

orders = []
for number, store in enumerate(sorted({i["store"] for i in paid}), start=1):
    lines = [
        {"upc": i["upc"], "name": i["name"], "quantity": i["quantity"], "line_total_cents": i["unit_price_cents"] * i["quantity"]}
        for i in paid
        if i["store"] == store
    ]
    orders.append(
        {
            "order_id": f"fixture-{store}-{number}",
            "store": store,
            "payment_reference": "pi_fixture_sandbox_reference",
            "lines": lines,
            "delivery_fee_cents": 0,
            "total_cents": sum(line["line_total_cents"] for line in lines),
        }
    )

paid_total = sum(order["total_cents"] for order in orders)
# The same basket bought at one store, from the stores' own prices.
single = {}
for store in {s for s, _ in prices}:
    if all((store, i["upc"]) in prices for i in paid):
        single[store] = sum(prices[(store, i["upc"])] for i in paid)
best = min(single, key=single.get)

out = {
    "orderId": "fixture-order-1",
    "listId": "fixture-list-1",
    "cart": cart(items),
    "cartAfter": cart(left),
    "approval": {"stores": sorted({i["store"] for i in paid}), "total_cents": paid_total},
    "summary": {
        "orders": orders,
        "paid_total_cents": paid_total,
        "savings_cents": max(0, single[best] - paid_total),
        "best_single_store": best,
        "best_single_store_total_cents": single[best],
        "unmatched": ["curry powder"],
        "cart": cart(left),
    },
}
(ROOT / ".redesign" / "fixtures" / "shopping.json").write_text(json.dumps(out, indent=1))
print(json.dumps({k: out["summary"][k] for k in ("paid_total_cents", "savings_cents", "best_single_store", "best_single_store_total_cents")}))
print([(i["store"], i["name"], i["unit_price_cents"], i["status"]) for i in items])
