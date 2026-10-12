import json
import sys
from pathlib import Path

import httpx
import pytest
from link_fakes import FakeLink, FakeStripe, reply, storefront_app

from api.agent.loop import run_shopping_agent, system_prompt
from api.agent.providers.base import AssistantMessage, ToolCall, UserMessage
from api.agent.providers.scripted import ScriptedProvider
from api.agent.schemas import ShoppingRequest
from api.cart.store import InMemoryCartStore
from api.cart.schemas import CartItem
from api.cart.service import CartService
from api.shopping.client import StorefrontClient
from api.shopping.errors import ShoppingError
from api.shopping.index import PriceIndex
from api.shopping.schemas import CheckoutQuote, OrderLine, Quote
from api.shopping.service import ShoppingList
from api.wallet.link import LinkMcp, LinkWallet, WalletError
from api.wallet.service import pay_cart, purchase_context

pytestmark = pytest.mark.anyio

SAMPLE = json.loads((Path(__file__).parent / "sample_list.json").read_text())
URL = "http://storefront/api/checkout"
EGGS = "410020000223"  # $2.89 at Walmart
CLUB_EGGS = "410020000865"  # $6.50 at BulkBarn Club, which has a $50 minimum
BODY = StorefrontClient.checkout_body({"walmart": [(EGGS, 2)]})
CONTEXT = "x" * 100


@pytest.fixture
def stripe():
    return FakeStripe()


@pytest.fixture
async def http(stripe):
    """An HTTP client for a storefront that has sandbox keys and a fake Stripe."""
    transport = httpx.ASGITransport(app=storefront_app(stripe))
    async with httpx.AsyncClient(transport=transport, base_url="http://storefront") as client:
        yield client


def wallet_for(link, **options):
    return LinkWallet(link, poll_seconds=0, **options)


# --- the wallet ---------------------------------------------------------------


async def test_pay_waits_for_approval_then_pays_the_store(http, stripe):
    link = FakeLink(http)
    asked = []

    paid = json.loads(await wallet_for(link).pay(URL, BODY, CONTEXT, asked.append))

    assert paid["total_cents"] == 578
    assert [(order["store"], order["status"]) for order in paid["orders"]] == [("walmart", "paid")]
    assert stripe.charges == [578]
    assert asked == ["https://app.link.com/approve/lsrq_1"]
    assert link.commands() == [
        "mpp_pay",
        "spend-request_retrieve",
        "spend-request_retrieve",
        "mpp_pay",
    ]
    first, second = link.calls[0][1], link.calls[-1][1]
    assert first["context"] == CONTEXT
    assert (first["method"], first["data"]) == ("POST", BODY)
    assert second["spendRequestId"] == "lsrq_1"
    assert second["approvedChallenge"].startswith('Payment id="')


async def test_every_payment_call_is_in_test_mode(http):
    link = FakeLink(http)
    await wallet_for(link).pay(URL, BODY, CONTEXT, lambda url: None)
    payments = [args for command, args in link.calls if command == "mpp_pay"]
    assert len(payments) == 2
    assert all(args["test"] is True for args in payments)


@pytest.mark.parametrize("decision", ["denied", "expired", "canceled"])
async def test_nothing_is_charged_when_the_user_does_not_approve(http, stripe, decision):
    link = FakeLink(http, decisions=[decision])
    with pytest.raises(WalletError, match=f"not approved in Link \\(status: {decision}\\)"):
        await wallet_for(link).pay(URL, BODY, CONTEXT, lambda url: None)
    assert link.commands().count("mpp_pay") == 1
    assert stripe.charges == []


async def test_waiting_for_approval_gives_up_after_the_timeout(http, stripe):
    link = FakeLink(http, decisions=["pending_approval"])
    wallet = LinkWallet(link, approval_timeout=0.05, poll_seconds=0.02)
    with pytest.raises(WalletError, match="No approval in Link after 0.05s"):
        await wallet.pay(URL, BODY, CONTEXT, lambda url: None)
    assert stripe.charges == []


async def test_not_being_logged_in_says_how_to_log_in(http):
    link = FakeLink(http)
    link.logged_in = False
    with pytest.raises(WalletError, match="npx @stripe/link-cli auth login"):
        await wallet_for(link).pay(URL, BODY, CONTEXT, lambda url: None)


async def test_a_store_that_refuses_the_paid_request_is_an_error():
    class Refuses:
        async def call_tool(self, name, arguments, timeout):
            return reply([{"status": 409, "headers": {}, "body": "out of stock"}])

    with pytest.raises(WalletError, match="HTTP 409.*out of stock"):
        await wallet_for(Refuses()).pay("http://x/checkout", BODY, CONTEXT, lambda url: None)


async def test_replies_with_trailing_suggestion_text_are_still_read():
    class Chatty:
        async def call_tool(self, name, arguments, timeout):
            body = json.dumps({"status": 200, "headers": {}, "body": "{}"})
            return reply(body + "\n\nNext: run `link-cli spend-request list`")

    assert await wallet_for(Chatty()).pay("http://x", BODY, CONTEXT, lambda url: None) == "{}"


def test_the_approval_note_is_long_enough_for_link():
    line = OrderLine(upc=EGGS, name="Eggs", quantity=1, unit_price_cents=50, line_total_cents=50)
    store = Quote(
        store="walmart", lines=[line], subtotal_cents=50, delivery_fee_cents=0, total_cents=50
    )
    note = purchase_context(["Walmart"], CheckoutQuote(stores=[store], total_cents=50))
    assert len(note) >= 100
    assert "Walmart" in note and "$0.50" in note


# --- the MCP connection -------------------------------------------------------


async def test_link_mcp_starts_a_server_calls_it_and_shuts_it_down():
    server = Path(__file__).parent / "fake_link_server.py"
    link = LinkMcp(f"{sys.executable} {server}")
    try:
        result = await link.call_tool(
            "call_write_tool", {"name": "mpp_pay", "arguments": {"test": True}}, timeout=20
        )
        again = await link.call_tool(
            "call_write_tool", {"name": "auth_status", "arguments": {}}, timeout=20
        )
    finally:
        await link.aclose()
    assert json.loads(result.content[0].text) == {"command": "mpp_pay", "echo": {"test": True}}
    assert json.loads(again.content[0].text)["command"] == "auth_status"


async def test_replies_from_a_real_mcp_server_are_read_correctly():
    # The wallet must read the MCP library's real result objects, success and failure.
    server = Path(__file__).parent / "fake_link_server.py"
    link = LinkMcp(f"{sys.executable} {server}")
    wallet = wallet_for(link)
    try:
        ok = await wallet._run("spend-request_retrieve", {"id": "lsrq_1"})
        with pytest.raises(WalletError, match="Link refused: .*Not authenticated.*auth login"):
            await wallet._run("fail", {})
    finally:
        await link.aclose()
    assert ok == {"command": "spend-request_retrieve", "echo": {"id": "lsrq_1"}}


async def test_link_mcp_reports_a_command_that_cannot_start():
    link = LinkMcp("definitely-not-a-real-command-xyz --mcp")
    try:
        with pytest.raises(WalletError, match="Could not start the Link CLI"):
            await link.call_tool("call_write_tool", {"name": "x", "arguments": {}}, timeout=5)
    finally:
        await link.aclose()


async def test_link_mcp_reports_a_server_that_dies_on_startup():
    link = LinkMcp(f"{sys.executable} -c 'raise SystemExit(3)'")
    try:
        with pytest.raises(WalletError, match="Could not start the Link CLI"):
            await link.call_tool("call_write_tool", {"name": "x", "arguments": {}}, timeout=5)
    finally:
        await link.aclose()


# --- paying for the cart ------------------------------------------------------


async def cart_with(http, *items):
    """A cart holding (store, upc, quantity) items at the stores' real prices."""
    client = StorefrontClient(http)
    index = await PriceIndex.load(client)
    cart_store = InMemoryCartStore()
    for store, upc, quantity in items:
        listing = index.get(store, upc)
        await cart_store.upsert(
            CartItem(
                store=store,
                upc=upc,
                name=listing.name,
                brand=listing.brand,
                size=str(listing.size),
                unit_price_cents=listing.price_cents,
                quantity=quantity,
                for_ingredient=listing.name,
                status="in_cart",
            )
        )
    cart = CartService(cart_store, index, ShoppingList([]), "auto", None)
    return client, index, cart


async def test_one_payment_covers_every_store_in_the_cart(http, stripe):
    client, index, cart = await cart_with(http, ("walmart", EGGS, 2), ("quickcart", EGGS, 1))
    link, asked = FakeLink(http), []

    paid, items, left_out = await pay_cart(
        cart=cart,
        index=index,
        client=client,
        wallet=wallet_for(link),
        approval_needed=lambda quote, url: asked.append((quote.total_cents, url)),
    )

    total = 578 + (332 + 599)  # QuickCart adds its delivery fee
    assert stripe.charges == [total]
    assert asked == [(total, "https://app.link.com/approve/lsrq_1")]
    assert [(order.store, order.total_cents) for order in paid.orders] == [
        ("walmart", 578),
        ("quickcart", 931),
    ]
    assert {order.payment_reference for order in paid.orders} == {paid.payment_reference}
    assert left_out == {}
    assert len(items) == 2
    assert (await cart.view()).items == []
    # What the user reads when approving names both stores and the one total.
    note = link.calls[0][1]["context"]
    assert "Walmart, QuickCart" in note and "$15.09" in note


async def test_a_paid_item_stuck_in_the_cart_does_not_hide_the_payment(http, stripe, monkeypatch):
    client, index, cart = await cart_with(http, ("walmart", EGGS, 2))

    async def unreachable(store, upc):
        raise ShoppingError("The cart could not be reached")

    monkeypatch.setattr(cart, "remove", unreachable)

    paid, items, _ = await pay_cart(
        cart=cart,
        index=index,
        client=client,
        wallet=wallet_for(FakeLink(http)),
        approval_needed=lambda quote, url: None,
    )

    # Reported as paid, so nothing asks for the money a second time.
    assert (paid.total_cents, stripe.charges, len(items)) == (578, [578], 1)


async def test_a_store_that_cannot_sell_is_left_out_and_the_rest_is_paid_once(http, stripe):
    client, index, cart = await cart_with(
        http, ("walmart", EGGS, 2), ("bulkbarn-club", CLUB_EGGS, 1), ("target", EGGS, 1)
    )
    link, asked = FakeLink(http), []

    paid, _, left_out = await pay_cart(
        cart=cart,
        index=index,
        client=client,
        wallet=wallet_for(link),
        approval_needed=lambda quote, url: asked.append(quote.total_cents),
    )

    assert list(left_out) == ["bulkbarn-club"]
    assert "$50.00 order minimum" in left_out["bulkbarn-club"]
    assert [order.store for order in paid.orders] == ["walmart", "target"]
    assert stripe.charges == asked == [578 + 312]  # still a single request
    # The left-out store's items are still in the cart.
    assert [(item.store, item.upc) for item in (await cart.view()).items] == [
        ("bulkbarn-club", CLUB_EGGS)
    ]


async def test_nothing_is_paid_when_no_store_can_sell(http, stripe):
    client, index, cart = await cart_with(http, ("bulkbarn-club", CLUB_EGGS, 1))
    link = FakeLink(http)

    with pytest.raises(ShoppingError, match="No store can sell.*order minimum"):
        await pay_cart(
            cart=cart,
            index=index,
            client=client,
            wallet=wallet_for(link),
            approval_needed=lambda quote, url: None,
        )
    assert link.calls == []
    assert stripe.charges == []
    assert len((await cart.view()).items) == 1


async def test_an_empty_cart_cannot_be_paid(http):
    client, index, cart = await cart_with(http)
    with pytest.raises(ShoppingError, match="cart is empty"):
        await pay_cart(
            cart=cart,
            index=index,
            client=client,
            wallet=wallet_for(FakeLink(http)),
            approval_needed=lambda quote, url: None,
        )


# --- the agent paying ---------------------------------------------------------


async def run(http, link, *, client=None, **request_fields):
    request = ShoppingRequest(items=SAMPLE, **request_fields)
    events = run_shopping_agent(
        request,
        provider=ScriptedProvider(),
        client=client or StorefrontClient(http),
        cart_store=InMemoryCartStore(),
        wallet=wallet_for(link) if link else None,
    )
    return [event async for event in events]


def checkout_results(events):
    return [e for e in events if e.type == "tool_result" and e.name == "checkout"]


@pytest.mark.parametrize("mode", ["manual", "auto"])
async def test_the_agent_pays_the_whole_basket_with_one_approval_in_both_modes(
    http, stripe, mode
):
    link = FakeLink(http)
    events = await run(http, link, mode=mode, budget_cents=15_000)

    done = events[-1]
    assert (done.type, done.finish_reason) == ("done", "completed")
    summary = done.summary

    # One request to the user, one charge, for the whole plan.
    (asked,) = [e for e in events if e.type == "approval_needed"]
    assert sorted(asked.stores) == ["pennywise-grocer", "target", "walmart"]
    assert asked.total_cents == 4760
    assert asked.approval_url.startswith("https://app.link.com/approve/")
    assert stripe.charges == [4760]
    assert link.commands().count("mpp_pay") == 2  # ask, then pay once approved

    # One order per store, all on the same payment.
    assert sorted(order.store for order in summary.orders) == sorted(asked.stores)
    assert len({order.order_id for order in summary.orders}) == 3
    assert len({order.payment_reference for order in summary.orders}) == 1
    assert sum(order.total_cents for order in summary.orders) == 4760
    assert summary.paid_total_cents == 4760

    # Paid items leave the cart, and still count as found.
    assert summary.cart.items == []
    assert summary.unmatched == ["Dragon fruit"]
    assert events[-2].type == "message"
    assert "Paid $47.60 for 3 stores in one payment" in events[-2].text


async def test_a_declined_approval_leaves_everything_in_the_cart(http, stripe):
    link = FakeLink(http, decisions=["denied"])
    events = await run(http, link, mode="auto", budget_cents=15_000)

    summary = events[-1].summary
    assert summary.orders == []
    assert stripe.charges == []
    assert len(summary.cart.items) == 13
    (result,) = checkout_results(events)
    assert result.ok is False
    assert "not approved in Link" in result.result["error"]
    assert "Not paid" in events[-2].text


async def test_stores_without_stripe_keys_stop_at_the_cart():
    transport = httpx.ASGITransport(app=storefront_app(None))
    async with httpx.AsyncClient(transport=transport, base_url="http://storefront") as http:
        link = FakeLink(http)
        events = await run(http, link, mode="auto", budget_cents=15_000)

    (result,) = checkout_results(events)
    assert result.ok is False
    assert "Payments are not configured" in result.result["error"]
    assert link.calls == []  # Link was never asked to pay
    assert len(events[-1].summary.cart.items) == 13


async def test_nothing_is_paid_when_the_stores_ask_for_a_different_amount(http, stripe):
    class Overcharging(StorefrontClient):
        async def quote(self, body):
            quote = await super().quote(body)
            return quote.model_copy(update={"total_cents": quote.total_cents + 100})

    link = FakeLink(http)
    events = await run(http, link, client=Overcharging(http), mode="auto", budget_cents=15_000)

    (result,) = checkout_results(events)
    assert "Nothing was paid" in result.result["error"]
    assert link.calls == []
    assert stripe.charges == []


# --- a model that stops before finishing --------------------------------------

OATS = {"ingredient": "Rolled oats", "upc": "410060000504"}
PLAN = AssistantMessage(tool_calls=[ToolCall("p", "plan_basket", {"items": [OATS]})])
SAVE = AssistantMessage(
    tool_calls=[ToolCall("a", "add_to_cart", {"items": [OATS | {"store": "walmart", "sure": True}]})]
)
PAY = AssistantMessage(tool_calls=[ToolCall("c", "checkout", {})])
CLAIMS_DONE = AssistantMessage("All done! I added everything to your cart.")


class Replay:
    """A fake model that plays back fixed turns, then keeps saying it is done."""

    def __init__(self, *turns):
        self._turns = list(turns)
        self.seen = []

    async def complete(self, system, messages, tools):
        self.seen.append(list(messages))
        return self._turns.pop(0) if self._turns else CLAIMS_DONE


async def run_model(http, provider, link=None):
    events = run_shopping_agent(
        ShoppingRequest(items=SAMPLE, mode="auto", budget_cents=15_000),
        provider=provider,
        client=StorefrontClient(http),
        cart_store=InMemoryCartStore(),
        wallet=wallet_for(link) if link else None,
    )
    return [event async for event in events]


async def test_a_model_that_claims_success_without_saving_is_reminded(http):
    provider = Replay(PLAN, CLAIMS_DONE, SAVE)
    events = await run_model(http, provider)

    (reminder,) = [e for e in events if e.type == "reminder"]
    assert "cart is empty" in reminder.text and "add_to_cart" in reminder.text
    # The reminder reached the model as the next message, and it then did the work.
    assert provider.seen[2][-1] == UserMessage(reminder.text)
    done = events[-1]
    assert done.finish_reason == "completed"
    assert [item.for_ingredient for item in done.summary.cart.items] == ["Rolled oats"]


async def test_a_model_that_saves_but_does_not_pay_is_reminded(http, stripe):
    provider = Replay(PLAN, SAVE, CLAIMS_DONE, PAY)
    events = await run_model(http, provider, FakeLink(http))

    (reminder,) = [e for e in events if e.type == "reminder"]
    assert reminder.text == "The cart has not been paid for. Call checkout now."
    assert len(stripe.charges) == 1
    assert events[-1].finish_reason == "completed"
    assert events[-1].summary.cart.items == []


async def test_a_declined_payment_is_not_asked_for_again(http, stripe):
    link = FakeLink(http, decisions=["denied"])
    events = await run_model(http, Replay(PLAN, SAVE, PAY), link)

    # The user said no once. No reminder, so no second request to their phone.
    assert [e for e in events if e.type == "reminder"] == []
    assert link.commands().count("mpp_pay") == 1
    assert events[-1].finish_reason == "completed"
    assert stripe.charges == []


async def test_reminders_stop_after_two_and_the_run_says_it_stopped_early(http):
    provider = Replay(PLAN)  # then only ever claims to be done
    events = await run_model(http, provider)

    assert len([e for e in events if e.type == "reminder"]) == 2
    done = events[-1]
    assert done.finish_reason == "stopped_early"
    assert done.summary.cart.items == []  # the summary tells the truth


async def test_without_a_wallet_there_is_no_checkout_tool(http):
    events = await run(http, None, mode="auto", budget_cents=15_000)
    assert "checkout" not in [e.name for e in events if e.type == "tool_call"]
    assert len(events[-1].summary.cart.items) == 13
    assert "checkout" not in system_prompt(can_pay=False)
    assert "checkout" in system_prompt(can_pay=True)
