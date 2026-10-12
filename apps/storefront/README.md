# FeedMe mock stores

Six fictional grocery stores for the shopping agent to buy from. This is a separate FastAPI app, and the agent only reaches it over HTTP, the way it would reach a real store.

The stores differ on purpose, so that comparing them is a real problem: one has an order minimum, one charges a delivery fee, one sells out, one has its own store brand.

## What is in it

| Module | What it does |
|---|---|
| `catalog/` | Loads and validates the seed data, and searches it |
| `agent_api/` | JSON routes for agents: stores, products, search |
| `feeds/` | A product feed per store |
| `pages/` | HTML pages for people, with schema.org `Product` data on each product page |
| `checkout/` | One checkout for baskets at several stores, paid with the Machine Payments Protocol |

The catalog lives in [`seed/`](seed): `stores.yaml`, `products.csv` and `offers.csv`. Products are identified by 12-digit UPC-A codes, and a bad check digit stops the app from starting. Prices are in whole cents.

## Run it

From the repo root:

```bash
pnpm dev:storefront
```

The stores are at http://localhost:8100. Browsing and search need no keys.

Checkout takes payment in Stripe's sandbox and needs `STRIPE_SECRET_KEY` and `STRIPE_PROFILE_ID` in the `.env` at the repo root. Without them it still validates a basket, then answers `503`. Live keys are refused at startup.

## Tests

```bash
uv run --package storefront pytest apps/storefront
```

The routes and the checkout flow are described in [docs/backend.md](../../docs/backend.md#mock-stores-and-the-shopping-agent).
