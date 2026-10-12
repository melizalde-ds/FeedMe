import asyncio
import json
from pathlib import Path

import httpx
import pytest

from api.agent.loop import run_shopping_agent
from api.agent.providers.base import AssistantMessage, ProviderError, ToolCall, ToolResults
from api.agent.providers.scripted import ScriptedProvider
from api.agent.schemas import ShoppingRequest
from api.cart.store import InMemoryCartStore
from api.shopping.client import StorefrontClient

pytestmark = pytest.mark.anyio

SAMPLE = json.loads((Path(__file__).parent / "sample_list.json").read_text())


async def run(storefront, provider=None, cart_store=None, items=SAMPLE, **options):
    request_fields = {k: options.pop(k) for k in ("mode", "budget_cents") if k in options}
    request = ShoppingRequest(items=items, **request_fields)
    events = run_shopping_agent(
        request,
        provider=provider or ScriptedProvider(),
        client=storefront,
        cart_store=cart_store or InMemoryCartStore(),
        **options,
    )
    return [event async for event in events]


class Replay:
    """A fake model that plays back fixed turns and records what it was sent."""

    def __init__(self, *turns):
        self._turns = list(turns)
        self.seen = []

    async def complete(self, system, messages, tools):
        self.seen.append(list(messages))
        return self._turns.pop(0) if self._turns else AssistantMessage("done")


def by_ingredient(summary):
    return {item.for_ingredient: item for item in summary.cart.items}


async def test_scripted_run_in_auto_mode_fills_the_cart(storefront):
    events = await run(storefront, mode="auto", budget_cents=15_000)

    assert events[0].type == "run_started"
    assert (events[0].mode, events[0].note) == ("auto", None)
    assert [e.name for e in events if e.type == "tool_call"] == (
        ["search_products"] * 14 + ["plan_basket", "add_to_cart"]
    )
    assert all(e.ok for e in events if e.type == "tool_result")
    done = events[-1]
    assert (done.type, done.finish_reason) == ("done", "completed")

    summary = done.summary
    assert summary.unmatched == ["Dragon fruit"]
    items = by_ingredient(summary)
    assert len(items) == 13
    # Clean matches went straight in.
    for name in ("Banana", "Oat milk", "Chicken thighs", "Garlic"):
        assert (items[name].status, items[name].hold_reasons) == ("in_cart", [])
    # The rest wait for the user, each for a reason decided in code.
    assert items["Eggs"].hold_reasons == ["store_brand"]
    assert items["Cooked brown rice"].hold_reasons == ["unsure_match"]
    assert items["Salmon fillet"].hold_reasons == ["out_of_stock_replacement"]
    assert items["Salmon fillet"].store != "walmart"  # out of stock there
    assert summary.needs_check == [i for i in summary.cart.items if i.status == "proposed"]
    # Prices are the stores' own.
    assert (items["Oat milk"].store, items["Oat milk"].unit_price_cents) == ("walmart", 399)

    assert summary.cart.in_cart.total_cents == sum(
        i.line_total_cents for i in summary.cart.items if i.status == "in_cart"
    )
    assert summary.savings_cents > 0
    assert summary.best_single_store_total_cents == (
        summary.cart.if_all_approved.total_cents + summary.savings_cents
    )


async def test_manual_mode_only_proposes_until_the_user_approves(storefront):
    cart_store = InMemoryCartStore()
    events = await run(storefront, cart_store=cart_store, mode="manual", budget_cents=15_000)

    summary = events[-1].summary
    assert {item.status for item in summary.cart.items} == {"proposed"}
    assert summary.cart.in_cart.total_cents == 0

    assert await cart_store.approve_all() == 13
    assert {item.status for item in await cart_store.list()} == {"in_cart"}


async def test_auto_without_a_budget_runs_as_manual(storefront):
    events = await run(storefront, mode="auto")
    started = events[0]
    assert (started.mode, started.requested_mode) == ("manual", "auto")
    assert "budget" in started.note
    assert {item.status for item in events[-1].summary.cart.items} == {"proposed"}


async def test_tool_errors_go_back_to_the_model(storefront):
    provider = Replay(
        AssistantMessage(
            tool_calls=[
                ToolCall("1", "buy_everything", {}),
                ToolCall("2", "search_products", {}),
                ToolCall("3", "add_to_cart", {"items": [
                    {"ingredient": "Eggs", "store": "walmart", "upc": "400000000000", "sure": True},
                    {"ingredient": "Caviar", "store": "walmart", "upc": "410020000223", "sure": True},
                ]}),
            ]
        )
    )
    events = await run(storefront, provider=provider)

    results = [e for e in events if e.type == "tool_result"]
    assert [r.ok for r in results] == [False, False, True]
    assert "Unknown tool 'buy_everything'" in results[0].result["error"]
    assert "query" in results[1].result["error"]
    rejected = results[2].result["rejected"]
    assert "does not sell" in rejected[0]["error"]
    assert "not on the shopping list" in rejected[1]["error"]

    # The second model call saw all three results, and the run carried on.
    sent_back = provider.seen[1][-1]
    assert isinstance(sent_back, ToolResults)
    assert [r.is_error for r in sent_back.results] == [True, True, False]
    assert events[-1].finish_reason == "completed"
    assert events[-1].summary.cart.items == []


async def test_step_limit_stops_a_model_that_never_finishes(storefront):
    class Forever:
        calls = 0

        async def complete(self, system, messages, tools):
            self.calls += 1
            return AssistantMessage(tool_calls=[ToolCall(str(self.calls), "view_cart", {})])

    provider = Forever()
    events = await run(storefront, provider=provider, max_steps=3)
    assert provider.calls == 3
    assert (events[-1].type, events[-1].finish_reason) == ("done", "step_limit")


async def test_a_slow_tool_times_out_and_the_run_continues(storefront):
    class SlowSearch(StorefrontClient):
        async def search(self, store, query, limit=10):
            await asyncio.sleep(5)

    slow = SlowSearch(storefront._http)
    provider = Replay(
        AssistantMessage(tool_calls=[ToolCall("1", "search_products", {"query": "eggs"})])
    )
    events = await run(slow, provider=provider, tool_timeout=0.05)
    (result,) = [e for e in events if e.type == "tool_result"]
    assert result.ok is False
    assert "timed out" in result.result["error"]
    assert events[-1].finish_reason == "completed"


async def test_unreachable_stores_fail_the_run_cleanly():
    def refuse(request):
        raise httpx.ConnectError("connection refused")

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(refuse), base_url="http://storefront"
    ) as http:
        events = await run(StorefrontClient(http))
    assert [e.type for e in events] == ["run_started", "error"]
    assert "could not be reached" in events[-1].message


async def test_a_model_failure_fails_the_run_cleanly(storefront):
    class Broken:
        async def complete(self, system, messages, tools):
            raise ProviderError("Bedrock call failed: throttled")

    events = await run(storefront, provider=Broken())
    assert [e.type for e in events] == ["run_started", "error"]
    assert events[-1].message == "Bedrock call failed: throttled"
