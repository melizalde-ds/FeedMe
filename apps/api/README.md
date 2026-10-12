# FeedMe API

The FastAPI server behind FeedMe. It plans the meals, checks every recipe against the household's allergies and diet, and runs the agent that buys the groceries.

The web app sends every data request here. The server verifies the user's Supabase token and forwards it, so Postgres row level security decides what that user can see.

## What is in it

| Module | What it does |
|---|---|
| `meals/` | The meal planner: search queries, embeddings, the Qdrant search and the safety checks |
| `allergens/` | The allergen reference, the matcher and the household's allergen profile |
| `household/` | Preferences, allergies and nutrition goals |
| `recipes/` | Reads recipes from Qdrant |
| `shopping/` | Store client, price index, unit conversion, price comparison and basket planning |
| `cart/` | The cart and the manual and auto buying rules |
| `agent/` | The tool loop, its tools and the model providers |
| `wallet/` | Pays a checkout through Stripe Link, over its MCP server |
| `runs/` | Shopping-run routes, streamed as server-sent events |
| `auth.py`, `db.py` | Token verification and the Supabase clients |

## Run it

From the repo root, with the stack up (`docker compose up -d --wait`):

```bash
pnpm dev:api
```

The API is at http://localhost:8000, with interactive docs at `/docs`. It reads its settings from the `.env` at the repo root.

To try the shopping agent alone, with no model and no Supabase, start the stores (`pnpm dev:storefront`) and run:

```bash
LLM_PROVIDER=scripted uv run --package api python -m api.agent \
  apps/api/tests/sample_list.json --mode auto --budget 150 --no-pay --pretty
```

## Tests

```bash
uv run --package api pytest apps/api
```

The tests use stand-ins for Supabase, the stores, Stripe, Link and the models, so nothing needs to be running. The tests against a live Supabase and the Stripe sandbox are opt-in.

Every route, setting and opt-in test is described in [docs/backend.md](../../docs/backend.md).
