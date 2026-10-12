"""Run the shopping agent from the command line against a running storefront.

    uv run --package api python -m api.agent apps/api/tests/sample_list.json --mode auto --budget 150

The cart lives in memory and is gone when the command exits, and nothing is saved to
Supabase: for that, start a run through the API (api.runs). Paying goes through
Stripe's Link CLI in test mode; pass --no-pay to stop at the saved cart.
"""

import argparse
import asyncio
import json
from pathlib import Path

import httpx

from api.agent.loop import run_shopping_agent
from api.agent.providers import get_provider
from api.agent.schemas import Event, ShoppingRequest
from api.cart.store import InMemoryCartStore
from api.settings import get_settings
from api.shopping.client import StorefrontClient
from api.wallet.link import LinkMcp, LinkWallet


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def describe(event: Event) -> str | None:
    """One readable line for an event, or None for the ones not worth showing."""
    match event.type:
        case "run_started":
            return f"Mode: {event.mode}" + (f" ({event.note})" if event.note else "")
        case "message":
            return f"Agent: {event.text}"
        case "reminder":
            return f"Reminder to the agent: {event.text}"
        case "approval_needed":
            return (
                f"APPROVE IN LINK: {_money(event.total_cents)} for {', '.join(event.stores)}\n"
                f"  {event.approval_url or 'check the Link app'}"
            )
        case "tool_result" if event.name == "checkout":
            if not event.ok:
                return f"Not paid: {event.result['error']}"
            result = event.result
            lines = [f"Paid {_money(result['total_cents'])}, payment {result['payment_reference']}"]
            lines += [
                f"  {order['store']}: {_money(order['total_cents'])}, order {order['order_id']}"
                for order in result["orders"]
            ]
            lines += [f"  Not paid, {store}: {why}" for store, why in result["not_paid"].items()]
            return "\n".join(lines)
        case "error":
            return f"Run failed: {event.message}"
        case "done":
            summary = event.summary
            paid = _money(summary.paid_total_cents)
            lines = [f"Finished ({event.finish_reason}). Paid {paid} for {len(summary.orders)} orders."]
            if summary.cart.items:
                left = _money(summary.cart.if_all_approved.total_cents)
                lines.append(f"Still in the cart: {len(summary.cart.items)} items, {left}")
            if summary.unmatched:
                lines.append(f"Not found: {', '.join(summary.unmatched)}")
            return "\n".join(lines)
    return None


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("list", type=Path, help="JSON file: [{name, quantity, unit}, ...]")
    parser.add_argument("--mode", choices=["manual", "auto"], default="manual")
    parser.add_argument("--budget", type=float, help="weekly budget in dollars")
    parser.add_argument("--no-pay", action="store_true", help="save the cart but pay nothing")
    parser.add_argument("--pretty", action="store_true", help="short readable lines, not JSON")
    args = parser.parse_args()

    settings = get_settings()
    request = ShoppingRequest(
        items=json.loads(args.list.read_text()),
        mode=args.mode,
        budget_cents=None if args.budget is None else round(args.budget * 100),
    )
    link = LinkMcp(settings.link_mcp_command)
    wallet = None
    if settings.payments_enabled and not args.no_pay:
        wallet = LinkWallet(link, approval_timeout=settings.link_approval_timeout_seconds)
    try:
        async with httpx.AsyncClient(base_url=settings.storefront_url) as http:
            events = run_shopping_agent(
                request,
                provider=get_provider(settings),
                client=StorefrontClient(http),
                cart_store=InMemoryCartStore(),
                wallet=wallet,
                max_steps=settings.agent_max_steps,
                tool_timeout=settings.agent_tool_timeout_seconds,
            )
            async for event in events:
                line = describe(event) if args.pretty else event.model_dump_json()
                if line:
                    print(line, flush=True)
    finally:
        await link.aclose()


if __name__ == "__main__":
    asyncio.run(main())
