# Backend: Supabase + FastAPI

How the local backend fits together, how to run it, and how to add to it.

## Architecture

```
                 login / signup (supabase-js, anon key)
             ┌──────────────────────────────────────────┐
             │                                          ▼
React web app ──/api/*──► FastAPI (apps/api) ──► Kong :54321 ──► auth (GoTrue)
 (Vite :5173)   Bearer     verifies the JWT,        │
                <user JWT> forwards it              └──────────► rest (PostgREST) ──► Postgres :54322
                              │                                    RLS: auth.uid() = user_id
                              ├──► Qdrant :6333 (recipe vectors)
                              ├──► meal planner ──► Bedrock (query model, embeddings), Jev
                              └──► shopping agent ──► mock stores :8100, Bedrock model, Link
```

- **Supabase is the CRUD backend.** Postgres holds the app tables, GoTrue handles accounts, and PostgREST exposes the tables over HTTP.
- **FastAPI is the proxy and the agentic server.** The web app sends all data requests to FastAPI. FastAPI forwards the user's own token, so Postgres row level security (RLS) decides what that user can see. The one exception is the buying agent's cart and orders, which only the server may write: there it uses the service key and sets the user id itself.
- **The web app only talks to Supabase for login.** It uses `supabase-js` with the anon key to sign up and sign in, then sends the access token to FastAPI as `Authorization: Bearer <token>`.

## Quick start

Prerequisites: Docker Desktop, [uv](https://docs.astral.sh/uv/), pnpm, and Python 3.14 (uv installs it if missing).

```powershell
# 1. One-time: generate your own secrets into .env (git-ignored)
python scripts/gen-env.py

# 2. Start Supabase + Qdrant
docker compose up -d --wait

# 3. Start the API (http://localhost:8000, docs at /docs)
pnpm dev:api

# or the web app and API together
pnpm dev
```

On every start, the one-shot `db-schema` service brings the database up to date once auth is up: [supabase/schema.sql](../supabase/schema.sql) on a new database, then any file in [supabase/migrations](../supabase/migrations) that hasn't run yet. It then exits, so `Exited (0)` next to it in `docker compose ps -a` is normal.

Stop the stack with `docker compose down`. Add `-v` to also wipe all local data: users, app tables **and the recipes in Qdrant**, which then need ingesting again. To reset only the database, see [Changing the schema](#changing-the-schema).

## Services

| Service | URL | What it is |
|---|---|---|
| FastAPI | http://localhost:8000 | Our API. The Vite dev server proxies `/api` here. |
| Supabase API (Kong) | http://localhost:54321 | Gateway: `/auth/v1` → GoTrue, `/rest/v1` → PostgREST |
| Postgres | `postgresql://postgres:postgres@localhost:54322/postgres` | Direct DB access (psql, DBeaver) |
| Studio | http://localhost:54323 | Supabase dashboard: browse tables, users, run SQL |
| Qdrant | http://localhost:6333/dashboard | Vector DB for recipes |

The Supabase API, Postgres, Studio and Qdrant ports are published on every network interface, not just `127.0.0.1`, and Studio has no login. Only run the stack on a network you trust. The credentials are throwaway local-dev values, so don't deploy this compose file.

## Secrets (`.env`)

`scripts/gen-env.py` writes three values to `.env` at the repo root:

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_JWT_SECRET` | GoTrue, PostgREST, FastAPI | Signs and verifies every token. Never expose it. |
| `SUPABASE_ANON_KEY` | Web app, FastAPI | Public. Safe in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | FastAPI only | **Bypasses RLS.** Server side only. |

Each developer generates their own. To rotate them, delete `.env`, run the script again, then run `docker compose up -d --force-recreate`. Existing logins become invalid.

FastAPI reads `.env` through [settings.py](../apps/api/src/api/settings.py). `SUPABASE_URL` defaults to `http://localhost:54321`.

## Authentication flow

1. The user signs up or signs in from the web app through GoTrue. Accounts are confirmed automatically in local dev, so no email is sent.
2. GoTrue returns an **access token**: a JWT signed with `SUPABASE_JWT_SECRET`, with `sub` = user id and `aud` = `authenticated`.
3. The web app calls FastAPI with `Authorization: Bearer <access token>`.
4. FastAPI's `CurrentUser` dependency ([auth.py](../apps/api/src/api/auth.py)) checks the signature, expiry and audience. Missing or invalid tokens get `401`. The anon and service keys are rejected too, because they aren't user tokens.
5. A route that uses `UserDB` sends that same token to PostgREST. Postgres sees the request as that user (`auth.uid()`) and applies RLS.

When a user registers, a trigger creates their `profiles` row automatically.

## Writing API routes

[db.py](../apps/api/src/api/db.py) provides three Supabase clients as FastAPI dependencies:

| Dependency | Acts as | Use for |
|---|---|---|
| `UserDB` | The logged-in user (RLS enforced) | **Everything a user triggers.** This is the default. |
| `ServiceDB` | `service_role` (RLS bypassed) | System work only: seeding, background agent jobs, admin actions. |
| `AnonDB` | Nobody (`anon`, RLS enforced) | The few tables a guest may read. Today that is the common allergen list. |
| `CurrentUser` | n/a | The verified user: `.id`, `.email`, `.token` |

```python
from api.auth import CurrentUser
from api.db import UserDB


@app.get("/api/preferences")
async def get_preferences(db: UserDB):
    # No user_id filter needed: RLS only returns this user's row.
    res = await db.table("preferences").select("*").maybe_single().execute()
    return res.data if res else None


@app.put("/api/preferences")
async def put_preferences(body: PreferencesIn, user: CurrentUser, db: UserDB):
    # Inserts must still set user_id; RLS rejects any other value.
    row = body.model_dump() | {"user_id": user.id}
    res = await db.table("preferences").upsert(row).execute()
    return res.data[0]
```

Rules of thumb:

- **Never use `ServiceDB` for a user request.** It returns every user's rows. If you think you need it, filter by `user.id` yourself and leave a comment explaining why.
- **Always set `user_id = user.id` on inserts.** RLS blocks other values with error `42501`.
- PostgREST errors come back as `postgrest.exceptions.APIError`, with Postgres or PostgREST codes such as `42501` (permission), `23505` (unique) and `23514` (check constraint). Map them to proper HTTP responses rather than letting them become 500s.

## Database schema

The app tables are defined in [supabase/schema.sql](../supabase/schema.sql) (the baseline) plus the numbered files in [supabase/migrations](../supabase/migrations). Recipes themselves live in Qdrant and are referenced by `recipe_id` (text).

| Table | Purpose |
|---|---|
| `profiles` | One row per auth user, created automatically on sign-up |
| `allergens`, `allergen_aliases` | The common allergen list (milk, egg, peanut…) and the other names people type for them (`dairy` → `milk`, `shrimp` → `shellfish`). Readable by anyone, writable by no client. |
| `user_allergens` | A user's allergens picked from the common list. **Add-only.** |
| `user_custom_allergens` | A user's other allergens, as short cleaned terms. **Add-only.** |
| `my_allergies` (view) | Both kinds in one list, for the UI and for FastAPI |
| `preferences` | Diet styles, likes/dislikes, household size, budget, plan length, the shopping mode (`manual` or `auto`), and `auto_buy`: start the buying agent without asking first. One row per user. |
| `nutrition_goals` | Daily macro targets plus optional body stats for the calculator (one row per user) |
| `meal_option_sessions` | One generation run, with snapshots of the allergies, preferences and goals it used |
| `meal_options` | Candidate recipes produced by a session, with compliance results and status. The meal planner also sets which meal type each is for, and the day of the plan for the ones it shows. |
| `meal_plans` | A saved plan, optionally linked to the session it came from. Keeps its own copy of household size and budget. |
| `meal_plan_slots` | One meal in a plan (day + meal type). Stores a copy of the recipe and points at the meal option it came from. |
| `favorites`, `feedback` | Hearts and like/dislike per recipe |
| `recipe_popularity` (view) | Aggregate favorite counts. Exposes no individual's data. |
| `grocery_lists`, `grocery_items` | One list per plan, built by `build_grocery_list`. Users can tick, edit, add and remove items. |
| `cart_items` | The buying agent's cart, one per grocery list. Read-only for users. |
| `orders` | One row per run of the buying agent, and so per payment: status, mode, totals in cents, the payment reference and the run's summary. Read-only for users. |
| `order_items` | One row per product bought, with its store, UPC, the store's own order number and the grocery item it covers. Read-only for users. |

`build_grocery_list(plan_id)` is a database function, called with `db.rpc("build_grocery_list", {"p_plan_id": ...})`. It adds up the ingredients of the plan's accepted slots, scaled from each recipe's servings to the plan's household size. Calling it again **replaces the list**, including items the user added and their ticks. Rebuilding also empties the list's cart. It refuses while a run is going or once something was paid for (an order that isn't `failed`, `cancelled` or `unpaid`).

Safety rules enforced by the database itself, not just by app code:

- **RLS on every table.** Users can only read and write rows where `user_id = auth.uid()`.
- **Child rows must belong to the same user as their parent.** For example, a slot can only point at the user's own plan. This uses composite foreign keys on `(id, user_id)`.
- **Allergies are add-only.** There are no update or delete policies, and those privileges are revoked. Adding a known name as a custom allergen (`dairy`, `peanuts`) stores the common allergen instead and returns no row, so read `my_allergies` again afterwards.
- **Text that can reach the model is cleaned.** Custom allergens and the preference lists are lowercased and trimmed, then rejected with error `22023` unless each is a short plain term: 2 to 40 characters, at most 4 words, letters a-z, digits, spaces, `'`, `&` and `-` only, and no instruction-like words. This also rejects some real foods, such as `jalapeño` and `egg drop soup`. FastAPI must still pass these values to the model as data, never as instructions.
- **No unsafe meal options.** A `meal_options` row with `allergen_safe = false` can't be inserted.
- **A new slot must come from a stored meal option** with the same owner and recipe.
- **Nutrition targets must be consistent.** Calories must be ≥ 1200, and macro calories (4/4/9 per gram) must be within 10% of the calorie target.
- **One accepted meal per slot.** Rejected and replaced slots stay as history, so you can add a replacement without deleting the old row.
- **The cart and the orders are read-only for users.** Only the buying agent writes them, through `ServiceDB`, and it sets `user_id` from the verified token itself. The server decides prices and pack counts, so a browser must not be able to edit them.
- **One run at a time per grocery list.** A unique index allows a single `pending` or `shopping` order per list, so two runs can never both pay for it.
- **A payment is saved once.** Order lines are unique per store, store order number and UPC, so saving the same payment again changes nothing.
- **Deleting a user deletes all their data.** Everything cascades from `auth.users`.

Known limit, accepted for the MVP: the two meal-option rules catch mistakes in our own code, not a user writing to Supabase directly with their own token. Such a user can insert a `meal_options` row marked safe, or change a slot's recipe after creating it.

### Changing the schema

Add a new numbered file to `supabase/migrations/`, such as `0002_add_something.sql`, then run `docker compose up -d --wait`. The `db-schema` service applies each file that isn't yet listed in the `migrations.applied` table, in file-name order. A file and its record are committed together, so a file that fails leaves nothing half done and is tried again on the next start. Teammates get the change by pulling and starting the stack.

- **Don't edit `schema.sql` or a migration that has been pushed.** A database that already ran it will not pick the edit up. Write a new migration instead.
- `schema.sql` is the baseline. It is applied only when `public.profiles` doesn't exist yet, and isn't idempotent.
- A migration runs as plain SQL in one transaction, so it can't use commands that refuse to run inside one, such as `create index concurrently`.
- See what has run with `docker compose logs db-schema`, or `select * from migrations.applied`.

If a migration fails because your local database is older than the baseline in the repo, start over. This deletes users and app data but keeps the recipes in Qdrant:

```powershell
docker compose rm -s -f db auth rest kong meta studio db-schema
docker volume rm meal-planner_db_data meal-planner_db_config
docker compose up -d --wait
```

New tables need `alter table … enable row level security` plus policies. Without RLS, any logged-in user can read every row.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `required variable SUPABASE_JWT_SECRET is missing a value` | No `.env` yet. Run `python scripts/gen-env.py`. |
| `auth` or `rest` stuck in `Created` | The DB wasn't healthy in time. Run `docker compose up -d --wait`. |
| FastAPI returns `401` | Missing, expired or non-user token. Sign in again in the web app. |
| PostgREST `42501` | RLS blocked it: wrong `user_id`, a forbidden operation (such as deleting an allergy), or `ServiceDB` vs `UserDB` mixed up. |
| PostgREST `PGRST205` "Could not find the table" | Table doesn't exist, or PostgREST hasn't reloaded its schema cache. Run `docker compose exec db psql -U postgres -c "notify pgrst, 'reload schema'"`. |
| Schema change not showing up, or a table from a teammate's commit is missing | Run `docker compose up -d --wait` and read `docker compose logs db-schema`. An edit to `schema.sql` or to a migration that already ran is ignored. See [Changing the schema](#changing-the-schema). |
| `db-schema` exits with an error | A migration failed; the log names the file and the SQL error. Nothing from that file was applied. |
| `22023` "contains a word that is not allowed" | The text filter on custom allergens and preference lists rejected a term. See the safety rules above. |
| `uv` warns `VIRTUAL_ENV ... does not match` | A different env (such as conda) is active. Harmless: uv uses the repo's `.venv`. |

## Mock stores and the shopping agent

The shopping agent takes a grocery list, compares prices across six mock stores, saves products to a cart and pays for the basket with one payment. Payment runs in Stripe's sandbox only, so no real card is ever charged.

```
shopping agent (apps/api) ──HTTP──► storefront (apps/storefront, :8100) ──► seed/*.csv, stores.yaml
   │    │                                   │
   │    └──► cart and orders (Supabase)     └──► Stripe sandbox (PaymentIntent)
   │
   └──MCP──► Link CLI (npx @stripe/link-cli) ──► your approval in the Link app
```

### Storefront (`apps/storefront`)

A separate FastAPI app that serves six stores from the seed files in `apps/storefront/seed/`. The agent only reaches it over HTTP.

```powershell
pnpm dev:storefront     # http://localhost:8100, also started by `pnpm dev`
```

| For | Routes |
|---|---|
| People | `/`, `/stores/{slug}`, `/stores/{slug}/search?q=`, `/stores/{slug}/products/{upc}` |
| Agents (JSON) | `/api/stores`, `/api/stores/{slug}`, `/api/stores/{slug}/products?q=`, `/api/stores/{slug}/products/{upc}` |
| Feeds | `/stores/{slug}/feed.json`, plus schema.org `Product` data on every product page |
| Checkout | `POST /api/checkout` (one payment for baskets at one or more stores) |

- Products are identified by 12-digit UPC-A codes, stored as text, in the company-internal range (starting with 4). Check digits are validated when the app starts, and a bad row stops it from starting.
- A national-brand product has the same UPC at every store. A store-brand product has its own UPC and is matched to others by `equivalence_group`, as "comparable" rather than identical.
- Prices are fixed and in whole cents. To change the catalog, edit the files in `apps/storefront/seed/`.

### Checkout

One checkout takes payment for baskets at several stores at once, with the Machine Payments Protocol. The buyer sends the products and quantities per store; each store prices its own basket.

```
POST /api/checkout
  {"orders": [{"store": "walmart", "lines": [{"upc": "410020000223", "quantity": 2}]},
              {"store": "target",  "lines": [{"upc": "410020000223", "quantity": 1}]}]}
  → 402  WWW-Authenticate: Payment ... method="stripe" ...   (body has every store's quote and one total)
POST again with the payment credential
  → 200  one order per store, all on the same payment, with a Payment-Receipt header
```

- **One payment, one approval.** The total of every store's basket is charged once. Each store still gets its own order number.
- Each store applies its own stock, order minimum and delivery fee. If any store can't sell its part, the checkout answers 409 and names every such store with the reason, so the buyer can leave those out and try again. Nothing is charged.
- Card payments need a combined total of at least $0.50.
- The challenge is bound to the request body, so a payment approved for one set of baskets can't pay for another.
- All six stores charge the same Stripe sandbox account. The stores keep no record of orders; the payment shows in the Stripe sandbox dashboard.
- Without the two Stripe settings below, checkout still validates a basket but answers 503.
- **Only sandbox keys are accepted.** The app refuses to start with a live key or a non-test profile ID.

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | Sandbox secret key (`sk_test_...`) |
| `STRIPE_PROFILE_ID` | Sandbox Stripe profile ID (`profile_test_...`). Look it up with `curl https://api.stripe.com/v2/network/business_profiles/me -u sk_test_...: -H "Stripe-Version: 2026-07-29.preview"` |

### Agent (`apps/api/src/api`)

| Module | What it does |
|---|---|
| `shopping/` | Storefront client, price index built from the store feeds, unit conversion, `compare_prices` and `plan_basket`. All plain code. |
| `cart/` | Cart items, the manual/auto rules, and where the cart is kept (Supabase, or memory for tests and the command line). |
| `wallet/` | Pays a store's checkout through Stripe's Link CLI, over its MCP server. |
| `agent/` | The tool loop, the tools, and the model providers. |
| `runs/` | The HTTP routes, turning a grocery list into the agent's shopping list, and keeping the order row up to date during a run. |
| `recipes/` | Reads recipes from Qdrant: by id, by search, and the list of ingredient names. |

- **Tools:** `list_stores`, `search_list`, `search_products`, `compare_prices`, `plan_basket`, `add_to_cart`, `remove_from_cart`, `view_cart`, and `checkout` when a wallet is connected.
- **The server sets the price and pack count.** The model only names a store, a UPC and the ingredient it is for.
- **One search for the whole list.** `search_list` takes no arguments: it searches every store for every item on the shopping list and gives each item's three best products, plus the items no store sells. The model picks from that and goes to `plan_basket`, so a run takes about five model turns however long the list is. Before it existed, a 97-item list used all 25 turns on single searches and bought nothing (2026-10-10).
- **Manual mode:** everything is saved as `proposed` until the user approves the basket.
- **Auto mode:** items go straight to `in_cart`, except these, which stay `proposed` for the user's check: store-brand items, replacements for something out of stock, unsure matches, more than 10 packs of one item, items whose amount wasn't known, and anything that would pass the budget. Auto with no budget runs as manual.
- **The mode is enforced in `cart/service.py`,** not in the prompt. The agent has one `add_to_cart` tool in both modes.
- **The agent pays in both modes.** At the end of a run it calls `checkout` once, which pays for everything in the cart, proposed or not, with a single payment. Your approval in the Link app is the check on it. Paid items leave the cart and the run's summary lists one order per store.

- **A model that stops early is reminded.** If the model says it is done with a planned basket but an empty cart, or with an unpaid cart when paying is on, the code tells it what is missing and lets it continue, at most twice. After that the run ends as `stopped_early`. It is never reminded to pay after a payment was tried, so a declined payment doesn't send a second request.
- **Trust the run's summary, not the model's message.** The summary in the `done` event is computed in code from the cart and the orders.

### Paying (`wallet/`)

The model only says "check out". Everything else about a payment is decided in code:

1. The agent asks the checkout for every store's quote. A store that can't sell its part is left out, its items stay in the cart, and the rest goes ahead.
2. It compares each store's quote with the cart. If any differ, nothing is paid.
3. It calls Link's `mpp_pay` command through the MCP server, always with test mode on.
4. Link asks you to approve once in the Link app. The run streams an `approval_needed` event with the total, the stores and the approval link, and checks every few seconds for up to 10 minutes.
5. Once approved, Link pays with a one-time token. No card number reaches this code or the model.

Setup, once per machine: Node, then `npx @stripe/link-cli auth login`. The Link account must be a US consumer account, and Link limits spending to $500 per request and per day, which now applies to the whole basket.

The agent starts the Link CLI itself as a child process (`npx @stripe/link-cli --mcp`). Don't use `link-cli serve`: it listens on port 54321, which is the Supabase gateway.

Settings (all optional, in `.env`):

| Variable | Default | Notes |
|---|---|---|
| `STOREFRONT_URL` | `http://localhost:8100` | Where the agent finds the stores |
| `QDRANT_URL` | `http://localhost:6333` | Where the recipes are |
| `QDRANT_COLLECTION` | `recipes` | The collection `scripts/ingest_recipes.py` loads |
| `LLM_PROVIDER` | `scripted` | `scripted` runs offline with no model. `bedrock` uses the Converse API. |
| `BEDROCK_MODEL_ID` | none | Required for `bedrock`. There is no default model. |
| `AWS_REGION` | none | Region for Bedrock |
| `AWS_BEARER_TOKEN_BEDROCK` | none | A Bedrock API key. Optional: without it the usual AWS credentials are used. |
| `AGENT_MAX_STEPS` | `25` | Model turns per run |
| `AGENT_TOOL_TIMEOUT_SECONDS` | `10` | Per tool call, except `checkout` |
| `PAYMENTS_ENABLED` | `true` | `false` stops every run at the saved cart |
| `LINK_MCP_COMMAND` | `npx -y @stripe/link-cli@0.27.0 --mcp` | The version is pinned on purpose |
| `LINK_APPROVAL_TIMEOUT_SECONDS` | `600` | How long to wait for your approval |

### API routes (`runs/`)

All of these need `Authorization: Bearer <access token>`. Someone else's list or order answers `404`.

| Route | What it does |
|---|---|
| `POST /api/grocery-lists/{list_id}/shopping-runs` | Starts the agent on the list and streams its events. Body: `{"mode": "manual"}` or `{"mode": "auto"}`; leave it out to use `preferences.shopping_mode`. Add `"remember": true` to also turn `auto_buy` on. |
| `POST /api/shopping-runs` | Takes chosen recipes, saves them as a plan with its grocery list, and starts the agent on it in the same call. See below. |
| `GET /api/grocery-lists/{list_id}/cart` | The cart with totals per store, delivery fees included |
| `POST /api/grocery-lists/{list_id}/cart/approve` | Moves every proposed item into the cart |
| `DELETE /api/grocery-lists/{list_id}/cart/items/{store}/{upc}` | Removes one item |
| `GET /api/auto-buy` | `{"auto_buy": false}`: whether to start the agent without asking the user first |
| `PUT /api/auto-buy` | Turns it on or off. Body and answer: `{"auto_buy": true}` |
| `GET /api/orders` | The user's runs, newest first |
| `GET /api/orders/{order_id}` | One run with the lines it bought and its final summary |

The "buy it for me" button:

1. On load, read `GET /api/auto-buy`. If it is `true`, skip the dialog and go to step 3 without `remember`.
2. Otherwise ask "Do you want us to buy this for you?". On no, call nothing. On yes, ask "Do this every time?".
3. Start the run with one of the two `POST` routes. Send `"remember": true` if the user said every time.

- `remember` only ever turns the setting on. Leaving it out or sending `false` keeps what is saved, so a run can't turn it off. `PUT /api/auto-buy` turns it off.
- It is saved when the user confirms, just before the run opens, and stays saved if the run then fails or pays nothing. A request refused before that (`404`, `422`, or `409` because nothing is left to buy) saves nothing. A `409` because a run is already going comes after the save, so the choice is kept.
- The server only stores the choice. It never starts a run by itself: every run comes from a request by the browser.
- `auto_buy` is not `shopping_mode`. `auto_buy` skips the question before a run. `shopping_mode` decides whether the agent's picks wait for approval inside a run.

What a run shops for:

- Every grocery item that isn't ticked (`checked`) and that an earlier run hasn't already paid for. If nothing is left, the answer is `409`.
- Plain water and ice are left out ("water", "boiling water", "ice cubes"): the stores' search matches on single words, so "water" would buy canned tuna in water.
- The amount is `quantity_estimate` and `unit`. An item with no usable amount is bought as one pack and held for the user's check (`unknown_quantity`). So is a name that is on the list in two different units.
- The budget is the plan's own `budget`. The user's weekly budget in `preferences` is not used here.
- Each run starts from an empty cart, so a second run never adds to what the first one left.

From recipes to the buyer (`POST /api/shopping-runs`):

```json
{
  "meals": [
    {"recipe_id": 38, "day_index": 0, "meal_type": "dinner"},
    {"recipe_id": 42, "day_index": 1, "meal_type": "dinner"}
  ],
  "household_size": 2,
  "budget_cents": 15000,
  "mode": "auto"
}
```

- `recipe_id` is the recipe's id in Qdrant. Only `meals` is required. An unknown id answers `404`, two meals in one slot `422`, and Qdrant being down `503`; nothing is saved in those cases.
- The server reads the ingredients itself. It saves a session, one option per recipe, the plan and its slots, calls `build_grocery_list`, and starts the run the same way the route above does.
- **One pack of each ingredient.** The recipes' amounts have no units ("4" blueberries, "1/4" sugar), and over a quarter of the recipes have a different number of amounts than ingredient names, so the amounts are not used. Each ingredient is saved once on the grocery list with `quantity_estimate` 1, however many recipes use it. That is a set amount, not an unknown one, so auto mode doesn't hold it for a check.
- Calling `build_grocery_list` again on such a plan clears the amounts. The items are then treated as unknown amounts and held.
- **The recipes are not checked for allergens here.** They are stored as `allergen_safe`, which the slots table requires, so only send recipes that already passed the allergen check: the ones `POST /api/meal-options` returned. See [Meal planner](#meal-planner).
- The mock stores sell a small range. A real recipe usually has ingredients no store stocks; the summary lists them as not found.

Following a run:

- The answer is a `text/event-stream`. Each event has its type in `event:` and JSON in `data:`. The first is `run_created` with the `order_id` and the `grocery_list_id`; the rest are the agent's own events (`run_started`, `message`, `tool_call`, `tool_result`, `cart_updated`, `approval_needed`, `reminder`, `error`), ending with `done` and the summary.
- It is a `POST` and needs a header, so the browser's `EventSource` can't open it. Read it with `fetch` and `response.body.getReader()`.
- **The run doesn't stop if the browser goes away.** A payment in progress still has to be recorded. After a reload, read `GET /api/orders/{order_id}` and the cart.
- The order row follows the run: `shopping` while it runs, `placed` as soon as a payment goes through, `unpaid` if it finished with nothing paid (the cart is saved), `failed` if it broke off.
- A list can have one run at a time; a second answers `409`, and so do cart changes while a run is going. If the server stops mid-run, the row stays `shopping` until the user's next run, which closes any run that has been silent for 15 minutes as `failed`.
- If a payment goes through but can't be saved after three tries, the stream sends an `error` event with the payment reference, and the whole payment is written to the server log.

Whoever is logged in to Link on the machine running the API approves and pays for every user's order. That is fine for a demo and nothing else.

### Command line

Try the agent without the API or Supabase, with the storefront running. The cart is kept in memory and discarded when the command exits. Add `--no-pay` to stop at the saved cart:

```powershell
uv run --package api python -m api.agent apps/api/tests/sample_list.json --mode auto --budget 150
```

Tests:

```powershell
uv run --package api pytest apps/api
uv run --package storefront pytest apps/storefront
```

The API tests use stand-ins for Supabase, the stores, Stripe, Link and the model, so they need nothing running. Two more sets are opt-in and need the stack up. Both sign up throwaway users and delete them afterwards; add `KEEP_LIVE_TEST_DATA=1` to keep the rows and look at them in Studio.

| What | Command | Real | Stand-ins |
|---|---|---|---|
| The routes against Supabase | `$env:RUN_SUPABASE_TESTS = "1"; uv run --package api pytest apps/api/tests/test_supabase_live.py` | Supabase | Stores' Stripe, Link, model |
| The household routes against Supabase | `$env:RUN_SUPABASE_TESTS = "1"; uv run --package api pytest apps/api/tests/test_household_live.py` | Supabase | Nothing else is called |
| The meal planner against Supabase | `$env:RUN_SUPABASE_TESTS = "1"; uv run --package api pytest apps/api/tests/test_meals_live.py` | Supabase | Qdrant, both models, Jev |
| A run paid in the Stripe sandbox | `$env:RUN_STRIPE_SANDBOX_TEST = "1"; uv run --package api pytest apps/api/tests/test_sandbox_live.py -s` | Supabase, the stores' checkout, one sandbox payment of about $48 | Link (Stripe's test helper grants the token, so no phone approval), model |

The sandbox test needs `STRIPE_SECRET_KEY` and `STRIPE_PROFILE_ID` in `.env`. It asks Stripe for the PaymentIntent the saved order points at and checks it succeeded for the same amount. With `-s` it prints the payment reference.

### The whole path by hand, with Link

`scripts/try_shopping_run.py` does what the web app's Grocery step does: it signs up a throwaway user, gives it a plan and a grocery list, starts a run on the running API and prints it live, then shows the saved order and deletes the user. With payments on you approve once in the Link app.

```powershell
docker compose up -d --wait
pnpm dev:storefront          # in one terminal
pnpm dev:api                 # in another
uv run --package api python scripts/try_shopping_run.py --budget 150
```

- `--recipes 38 42` sends those recipe ids to `POST /api/shopping-runs` instead of building a list from the file. Qdrant has to hold the recipes.
- `--keep` leaves the user and its rows in Supabase, and prints the login to use.
- `--mode manual`, a different list file, or `--api` for another address are optional.
- To stop at the saved cart and pay nothing, start the API with `PAYMENTS_ENABLED=false`. Add `LLM_PROVIDER=scripted` to run without a model.

What has and hasn't run for real:

- The Bedrock provider has run for real (2026-10-10) with payments off, on the same 14-item list:

  | Model | Result |
  |---|---|
  | `nvidia.nemotron-super-3-120b` | Correct basket in two of two runs, about 25 s each. This is the model set in `.env`. |
  | `nvidia.nemotron-nano-3-30b` | Correct basket in one run, 28 s. |
  | `nvidia.nemotron-nano-9b-v2` | One run claimed success with an empty cart; a second run was correct but took 125 s. |

- A real model has paid end to end (2026-10-10): `nvidia.nemotron-super-3-120b` searched, planned, saved and paid a three-store basket through Link with one approval and one $47.60 sandbox payment.
- Payment is tested against a fake Stripe and a fake Link server in the test suite.
- The full flow has run for real in the Stripe sandbox (2026-10-10): the scripted agent paid for a three-store basket through Link with one approval and one $47.60 payment. Add `--pretty` to the command above for short readable output.
- With the Stripe keys in `.env`, this makes one real sandbox payment without Link:

```powershell
$env:RUN_STRIPE_SANDBOX_TEST = "1"; uv run --package storefront pytest apps/storefront -k sandbox
```

## Household: preferences, allergies and nutrition goals

What a household saves about itself, in `apps/api/src/api/household`. The [meal planner](#meal-planner) reads all three on its next run.

| Route | What it does |
|---|---|
| `GET /api/preferences` | The saved preferences, or `null` if the user never saved any |
| `PUT /api/preferences` | Replaces them and answers with what was stored |
| `GET /api/allergens` | The common allergens to choose from: `[{"id": "milk", "label": "Milk / dairy"}, …]`. **Needs no sign-in**, so the form can show them to a guest. |
| `GET /api/allergies` | The user's allergies: `[{"allergen", "label", "kind": "common" or "custom"}]`, oldest first |
| `POST /api/allergies` | Adds one. Body `{"allergen_id": "milk"}` or `{"name": "strawberries"}`. Answers `201` with the whole list. |
| `GET /api/nutrition-goals` | The daily targets, or `null` |
| `PUT /api/nutrition-goals` | Replaces them. Body and answer: `{"calories", "protein_g", "carbs_g", "fat_g"}` |

All but `GET /api/allergens` need `Authorization: Bearer <access token>`.

```json
{
  "diet_styles": ["vegetarian"],
  "liked_foods": ["rice", "tofu"],
  "disliked_foods": [],
  "liked_cuisines": [],
  "disliked_cuisines": ["fast food"],
  "household_size": 4,
  "weekly_budget": 120.5,
  "max_cook_time_minutes": 30,
  "plan_days": 5,
  "meals_per_day": 2
}
```

- **A refusal answers `422` with a sentence in `detail`** that can be shown to the user as it is, such as `Liked foods: "x" is too short.` or `Calories must be at least 1200.` The number ranges are checked in `household/schemas.py` with the same limits as the tables. The rules for the lists and for typed allergens live in the database only, and its message is passed on.
- **The lists come back cleaned:** lowercased, trimmed, sorted and without duplicates. Show what the answer holds, not what was sent.
- **`PUT` replaces every field it knows.** A field left out goes back to its default, so send the whole object. `shopping_mode` and `auto_buy` are not part of it and keep their values.
- **`GET /api/preferences` is `null` only until the row exists.** `PUT /api/auto-buy` creates the row too, and from then on the answer is the table's defaults (household of 1, 7 days, 3 meals).
- **Allergies are add-only**, as in the database: there is no route to change or remove one. Adding one the user already has changes nothing and still answers `201`.
- **A typed name the common list knows is stored as the common allergen:** `{"name": "Dairy"}` adds `milk`. Read the list in the answer rather than assuming what was added. An `allergen_id` that isn't on the list answers `404`.
- **Nutrition goals cover the four targets only.** The table's optional columns (fiber, sodium, body stats) are neither read nor changed. Calories must be at least 1200, and protein, carbs and fat (4/4/9 kcal per gram) must add up to within 10% of them.

## Meal planner

`POST /api/meal-options` chooses the meals for a signed-in user's plan and checks each one against the household's allergies and diet. It lives in `apps/api/src/api/meals`, with the allergen reference in `apps/api/src/api/allergens`.

```
for each meal type (breakfast, lunch, dinner):
  query model ──► a few different dishes, each written like a recipe card
  Titan       ──► one vector per dish
  Qdrant      ──► nearest recipes behind the hard filter (allergens, diet, cooling, not-a-meal)
  reranker    ──► best fit first (a stand-in keeps the search order for now)
  safety      ──► reference files on the whole recipe, then Jev; 15 at a time until 10 pass
```

### The three allergen gates

Putting "no peanuts" in a search text pulls peanut recipes closer, so nothing that must be left out is ever part of the search text. It is enforced three times instead:

1. **The Qdrant filter.** The recipes use about 4,100 distinct ingredient names. The matcher reads each one once (`allergens/vocabulary.py`), and a household's filter is the list of names it rules out. That is why `vanilla yogurt` is blocked for milk and `coconut milk` is not, although Qdrant can only match a name exactly. The names are read from Qdrant again every 10 minutes.
2. **The reference files on the whole recipe.** The raw ingredient names and the cooking steps, which the filter never sees. In the steps only words that name the allergen itself count ("butter"), since the weaker ones are mostly verbs and cookware ("roll", "glaze").
3. **Jev.** One request per recipe, one yes/no question per allergen and per diet. It catches what a word list can't: brand names, and ingredients that only appear in the steps ("serve over angel hair pasta"). A recipe is dropped at a probability of `ALLERGEN_BLOCK_PROBABILITY` or more.

Either of the last two can rule a recipe out. **A recipe Jev could not be asked about is left out, and with Jev down or `JEV_API` unset the route answers `503`.** Nothing unchecked is ever returned.

What blocks:

- **Every tier of the reference file except `broad_category`** ("sauce", "soup", "seasoning"). So `margarine` (check the label for milk) and `coconut` (related to tree nuts) are blocked. This is strict on purpose and leaves a milk-allergic household about a third of the main dishes.
- **The 10 allergens of `public.allergens` map to the reference file's 14 groups in `allergens/profile.py`:** `shellfish` is crustaceans and molluscs, `wheat` is the gluten cereals limited to wheat, `gluten` is all of them.
- **A custom allergen that names a group** (`mustard`, `celery`) uses that group. Any other is matched by name in the ingredients, also inside longer words (`corn` in `cornstarch`), and asked to Jev.
- **`allergens/allergen_reference.json` is kept as supplied.** `allergen_extras.json` adds the ingredient names of the recipe data it did not know (`crabmeat`, `soymilk`, `cool whip`...). Add rows there, not to the reference file.

### Diet styles

Hard rules, enforced in the same three places. `meals/diet_reference.json` holds what a diet avoids that is not an allergen (meat, pork, poultry, gelatin, honey, alcohol).

| Style | Left out |
|---|---|
| `vegetarian`, `vegan`, `pescatarian` | Meat, poultry and gelatin; fish and shellfish too unless pescatarian; dairy, eggs and honey too if vegan |
| `dairy-free`, `gluten-free` | The milk and gluten cereal groups, at the tiers that mean "is" or "usually is" |
| `low-carb` | Recipes with more than `LOW_CARB_MAX_SHARE` of their calories from carbohydrates |
| `halal` | Pork and alcohol. The answer carries a warning: a recipe can't show how its meat was prepared. |
| `kosher` | Pork, shellfish, and meat together with dairy. Same kind of warning. |

Any other style (`keto`, `mediterranean`) is passed to the query model as a preference only. So are liked and disliked foods, cuisines, cooking time and the nutrition goals.

### What a run reads and saves

- **Reads** `my_allergies`, `preferences`, `nutrition_goals`, and every meal option the user was shown in the last `COOLING_DAYS` (any status but `queued`). Those recipes are left out of the search.
- **Saves** a `meal_option_sessions` row with snapshots of what it read, and one `meal_options` row per checked recipe, with the evidence in `compliance`: the reference file's notes, Jev's probability per question, and the Jev model.
- **Keeps 10 per meal type** (more for plans longer than 7 days). The best `plan_days` are saved as `shown` with a `day_index`; the rest are `queued` alternatives. A recipe is offered for one meal type only.
- Meal types come from `preferences.meals_per_day`: 1 is dinner, 2 adds lunch, 3 adds breakfast, 4 adds a snack.

### Routes

| Route | What it does |
|---|---|
| `POST /api/meal-options` | Runs the planner. Optional body `{"plan_days": 5, "meal_types": ["lunch", "dinner"]}` replaces the saved plan length and meals for this run. Allergies can't be changed here. |
| `GET /api/meal-options/{session_id}` | A saved set of options with the recipes' ingredients and steps. Someone else's answers `404`. |

`POST` answers `201` with the options per meal type and a `warnings` list to show the user (a diet that can't be verified, a meal type that came up short, a fallback that was used). `422` means no recipe fits the household's rules, and `503` that Qdrant, the embedding model or Jev could not be reached. In both cases the session is saved as `failed` with the reason.

### Settings

| Variable | Default | Notes |
|---|---|---|
| `JEV_API` | none | TypeSafe API key. Required: without it the route answers `503`. |
| `JEV_MODEL` | `jev-1.13.0` | Pinned, so a new model can't change what counts as safe unnoticed. |
| `ALLERGEN_BLOCK_PROBABILITY` | `0.2` | Drop a recipe at this Jev probability or more. See the note in `settings.py` on how it was chosen. |
| `DIET_BLOCK_PROBABILITY` | `0.4` | The same for diet questions. |
| `LLM_PROVIDER`, `BEDROCK_MODEL_ID` | as for the agent | The query model. With `scripted`, fixed searches are used and the answer says so. |
| `MEAL_QUERY_MODEL_ID` | none | A different Bedrock model for the queries only. |
| `BEDROCK_EMBED_MODEL_ID`, `EMBED_DIMENSIONS` | Titan V2, `1024` | Must match `scripts/ingest_recipes.py`. |
| `MEAL_IDEAS` | `4` | Dishes searched per meal type. See below. |
| `MEAL_CANDIDATES`, `MEAL_CHECK_BATCH`, `MEAL_OPTIONS` | `50`, `15`, `10` | Recipes reranked, checked at a time, and kept, per meal type. |
| `COOLING_DAYS` | `14` | |

### Known limits

- **A request takes 25 to 35 seconds, most of it waiting for embeddings.** Our Bedrock key allowed about 0.6 Titan calls a second on 2026-10-10, and a three-meal plan needs 12: 18 to 27 seconds. The query model takes about 3 seconds and the checks a few. The log line per meal type from `api.meals.pipeline` shows the split. Ask AWS for a higher Titan quota, then raise `MEAL_IDEAS` for more variety.
- **No reranker yet.** `meals/rerank.py` has the interface and a stand-in that keeps the search order. Return the real one from `get_reranker` in `meals/router.py`. Until then side dishes and slow recipes can rank high.
- **Jev's limit was set on a small sample:** 14 hidden-allergen recipes and 56 real ones. Check more before trusting it beyond a demo.
- **`low-carb` filters on a field Qdrant has no index for.** It works (half a second on 10,800 recipes) and will slow down as more are loaded. `uv run scripts/ingest_recipes.py --limit 1` adds the index and embeds nothing. Without `--limit` the script embeds every recipe not loaded yet.

## Not built yet

- **An order history screen.** The web app shows the last run for the current plan (`GET /api/orders/{id}`); `GET /api/orders` has no screen yet.
- **More alternatives and replacing a meal** (`/more`, `/replace`). The queued options are saved for them, but no route hands them out yet.
- **Paying for a saved cart without a new run.** The agent pays at the end of its own run. Items a store couldn't sell stay in the cart until the next run, which starts over for whatever is still unbought.
- **CRUD endpoints** for the other tables (profiles, plans, favorites, feedback, grocery lists). Besides the routes above, only `/api/health` exists.
