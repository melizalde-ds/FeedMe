"""Run the buying agent end to end through the running API, as the web app will.

    uv run --package api python scripts/try_shopping_run.py --budget 150
    uv run --package api python scripts/try_shopping_run.py --budget 150 --recipes 38 42

It signs up a throwaway user in the local Supabase, gives it a meal plan and a
grocery list, starts a shopping run on the API and prints the run as it happens.
Then it shows the order that was saved, and deletes the user again.

With --recipes the script makes no plan itself. It sends the recipe ids to the
API, which reads their ingredients from Qdrant, saves the plan and the grocery
list, and starts the run: one call, the way the planner hands meals to the buyer.

With payments on, the run asks you to approve one payment in the Link app. It is
always a Stripe sandbox payment: no real card is charged. To stop at the saved
cart instead, start the API with PAYMENTS_ENABLED=false.

Needs running: the stack (docker compose up -d --wait), the stores
(pnpm dev:storefront) and the API (pnpm dev:api).
"""

import argparse
import asyncio
import json
import uuid
from pathlib import Path

import httpx
from pydantic import TypeAdapter

from api.agent.__main__ import describe
from api.agent.schemas import Event
from api.settings import get_settings

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_LIST = ROOT / "apps/api/tests/sample_list.json"
PASSWORD = "try-shopping-1"
_event = TypeAdapter(Event)


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


async def _rows(supabase: httpx.AsyncClient, token: str, path: str, body: dict):
    """Inserts a row, or calls a function, as the user."""
    response = await supabase.post(
        f"/rest/v1/{path}",
        json=body,
        headers={"Authorization": f"Bearer {token}", "Prefer": "return=representation"},
    )
    if response.is_error:
        raise SystemExit(f"Supabase refused {path}: {response.text}")
    return response.json()


async def _grocery_list(supabase, token, user_id, items, budget) -> str:
    """A one-meal plan whose ingredients are the list, and the grocery list built from it."""
    user = {"user_id": user_id}
    session = (await _rows(supabase, token, "meal_option_sessions", user))[0]["id"]
    recipe = {"recipe_id": "try-shopping-run", "title": "Try shopping run"}
    option = user | recipe | {"session_id": session, "allergen_safe": True, "rank": 1}
    option_id = (await _rows(supabase, token, "meal_options", option))[0]["id"]
    plan = user | {"household_size": 2, "budget": budget}
    plan_id = (await _rows(supabase, token, "meal_plans", plan))[0]["id"]
    slot = user | recipe | {
        "plan_id": plan_id,
        "option_id": option_id,
        "day_index": 0,
        "meal_type": "dinner",
        "servings": 2,
        "ingredients": [
            {"name": i["name"], "quantity": str(i["quantity"]), "unit": i.get("unit", "")}
            for i in items
        ],
    }
    await _rows(supabase, token, "meal_plan_slots", slot)
    return await _rows(supabase, token, "rpc/build_grocery_list", {"p_plan_id": plan_id})


async def _follow(api: httpx.AsyncClient, path: str, body: dict) -> dict | None:
    """Starts a run, prints its events as they arrive, and returns its first
    event, which names the order and the grocery list."""
    created = None
    async with api.stream("POST", path, json=body) as response:
        if response.is_error:
            raise SystemExit(f"The API refused the run: {(await response.aread()).decode()}")
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            payload = line.removeprefix("data: ")
            if json.loads(payload)["type"] == "run_created":
                created = json.loads(payload)
                print(f"Run started. Order {created['order_id']}")
            elif text := describe(_event.validate_json(payload)):
                print(text, flush=True)
    return created


async def _show_result(api: httpx.AsyncClient, list_id: str, order_id: str) -> None:
    order = (await api.get(f"/api/orders/{order_id}")).json()
    print(f"\nSaved in Supabase: order is '{order['status']}'")
    if order["payment_reference"]:
        print(
            f"  Paid {_money(order['total_cents'])} "
            f"({_money(order['subtotal_cents'])} + {_money(order['delivery_fee_cents'])} delivery), "
            f"payment {order['payment_reference']}"
        )
    by_store: dict[tuple[str, str], list[dict]] = {}
    for line in order["order_items"]:
        by_store.setdefault((line["store"], line["store_order_id"]), []).append(line)
    for (store, store_order), lines in by_store.items():
        print(f"  {store}, order {store_order}:")
        for line in lines:
            total = _money(line["line_total_cents"])
            print(f"    {line['quantity']} x {line['product_name']}  {total}")
    if order["error_message"]:
        print(f"  Problem: {order['error_message']}")
    cart = (await api.get(f"/api/grocery-lists/{list_id}/cart")).json()
    if cart["items"]:
        waiting = sum(item["status"] == "proposed" for item in cart["items"])
        total = _money(cart["if_all_approved"]["total_cents"])
        print(f"  Still in the cart: {len(cart['items'])} items, {total} ({waiting} waiting for a check)")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("list", type=Path, nargs="?", default=SAMPLE_LIST,
                        help="JSON file: [{name, quantity, unit}, ...]")
    parser.add_argument("--recipes", type=int, nargs="+", metavar="ID",
                        help="shop for these recipes from Qdrant instead of the list file")
    parser.add_argument("--api", default="http://localhost:8000", help="where the API runs")
    parser.add_argument("--mode", choices=["manual", "auto"], default="auto")
    parser.add_argument("--budget", type=float, help="the plan's budget in dollars; auto needs one")
    parser.add_argument("--keep", action="store_true",
                        help="keep the user and its rows, to look at them in Studio")
    args = parser.parse_args()
    settings = get_settings()

    # No overall time limit on reading: an approval can take minutes.
    timeout = httpx.Timeout(30, read=None)
    anon = {"apikey": settings.supabase_anon_key}
    async with (
        httpx.AsyncClient(base_url=settings.supabase_url, headers=anon, timeout=30) as supabase,
        httpx.AsyncClient(base_url=args.api, timeout=timeout) as api,
    ):
        try:
            (await api.get("/api/health")).raise_for_status()
        except httpx.HTTPError as exc:
            raise SystemExit(f"The API is not answering at {args.api} ({exc}). Run: pnpm dev:api")

        email = f"try-{uuid.uuid4().hex[:10]}@example.com"
        signup = await supabase.post("/auth/v1/signup", json={"email": email, "password": PASSWORD})
        if signup.is_error:
            raise SystemExit(f"Could not sign up a test user: {signup.text}")
        user_id, token = signup.json()["user"]["id"], signup.json()["access_token"]
        api.headers["Authorization"] = f"Bearer {token}"
        print(f"Signed up {email}")
        try:
            if args.recipes:
                # One dinner a day. The API turns the recipes into the plan and the list.
                body = {
                    "meals": [
                        {"recipe_id": recipe_id, "day_index": day, "meal_type": "dinner"}
                        for day, recipe_id in enumerate(args.recipes)
                    ],
                    "budget_cents": None if args.budget is None else round(args.budget * 100),
                    "mode": args.mode,
                }
                print(f"Sending {len(args.recipes)} recipes to the API")
                created = await _follow(api, "/api/shopping-runs", body)
            else:
                items = json.loads(args.list.read_text())
                list_id = await _grocery_list(supabase, token, user_id, items, args.budget)
                print(f"Grocery list {list_id} with {len(items)} items")
                path = f"/api/grocery-lists/{list_id}/shopping-runs"
                created = await _follow(api, path, {"mode": args.mode})
            if created:
                await _show_result(api, created["grocery_list_id"], created["order_id"])
        finally:
            if args.keep:
                print(f"\nKept. Sign in as {email} / {PASSWORD}, or open http://localhost:54323")
            else:
                service = settings.supabase_service_role_key
                await supabase.delete(
                    f"/auth/v1/admin/users/{user_id}",
                    headers={"apikey": service, "Authorization": f"Bearer {service}"},
                )
                print("\nTest user deleted (use --keep to look at the rows in Studio).")


if __name__ == "__main__":
    asyncio.run(main())
