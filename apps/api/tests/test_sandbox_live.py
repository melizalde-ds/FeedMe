"""A whole shopping run paid for in the real Stripe sandbox. Skipped unless you opt in:

    RUN_STRIPE_SANDBOX_TEST=1 uv run --package api pytest apps/api/tests/test_sandbox_live.py -s

Real here: the API with its Supabase tables, the stores' checkout code, and one
Stripe sandbox payment of about $48 covering three stores. Stripe's test helper
grants the payment token that Link would, so nobody has to approve on a phone.
The model is the offline scripted one. No real card is involved.

Needs the stack from docker-compose.yaml running, and in .env the Supabase keys,
STRIPE_SECRET_KEY (sk_test_...) and STRIPE_PROFILE_ID (profile_test_...).
Add KEEP_LIVE_TEST_DATA=1 to keep the test user and its order to look at in Studio.
"""

import os
import time

import httpx
import pytest
from live_supabase import (  # noqa: F401 - the last three are fixtures
    KEEP_DATA,
    PASSWORD,
    SAMPLE,
    as_user,
    events_of,
    ingredients,
    service,
    sign_up,
    supabase_settings,
)
from mpp import Challenge, Credential
from storefront.main import create_app as create_storefront
from storefront.settings import Settings as StorefrontSettings

from api.agent.providers.scripted import ScriptedProvider
from api.main import create_app
from api.runs import router as runs
from api.shopping.client import StorefrontClient

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(
        os.environ.get("RUN_STRIPE_SANDBOX_TEST") != "1",
        reason="set RUN_STRIPE_SANDBOX_TEST=1 to make a real Stripe sandbox payment",
    ),
]

STRIPE = "https://api.stripe.com"
# Shared payment tokens are a preview feature (same version as the storefront's own test).
TOKEN_API_VERSION = "2026-09-30.preview"


class SandboxWallet:
    """Pays a checkout the way Link does, with a token from Stripe's test helper
    in place of the user's approval."""

    approval_timeout = 60.0

    def __init__(self, stores: httpx.AsyncClient, stripe: httpx.AsyncClient) -> None:
        self._stores = stores
        self._stripe = stripe
        self.paid_cents: list[int] = []

    async def pay(self, url, body, context, approval_needed) -> str:
        headers = {"Content-Type": "application/json"}
        probe = await self._stores.post(url, content=body, headers=headers)
        assert probe.status_code == 402, probe.text
        total_cents = probe.json()["quote"]["total_cents"]
        granted = await self._stripe.post(
            "/v1/test_helpers/shared_payment/granted_tokens",
            headers={"Stripe-Version": TOKEN_API_VERSION},
            data={
                "payment_method": "pm_card_visa",
                "usage_limits[currency]": "usd",
                "usage_limits[max_amount]": str(total_cents),
                "usage_limits[expires_at]": str(int(time.time()) + 3600),
            },
        )
        assert granted.status_code == 200, granted.text
        challenge = Challenge.from_www_authenticate(probe.headers["www-authenticate"])
        token = granted.json()["id"]
        credential = Credential(challenge=challenge.to_echo(), payload={"spt": token})
        paid = await self._stores.post(
            url, content=body, headers=headers | {"Authorization": credential.to_authorization()}
        )
        assert paid.status_code == 200, paid.text
        self.paid_cents.append(total_cents)
        return paid.text


async def test_a_run_pays_the_stripe_sandbox_and_the_order_is_saved(
    supabase_settings, sign_up, service
):
    store_settings = StorefrontSettings()
    assert store_settings.stripe_secret_key and store_settings.stripe_profile_id, (
        "STRIPE_SECRET_KEY and STRIPE_PROFILE_ID must be in .env"
    )
    account = await sign_up()
    await account.plan_groceries(ingredients(SAMPLE))

    app = create_app(supabase_settings)
    stores_app = httpx.ASGITransport(app=create_storefront(settings=store_settings))
    async with (
        httpx.AsyncClient(transport=stores_app, base_url="http://storefront") as stores,
        httpx.AsyncClient(
            base_url=STRIPE, auth=(store_settings.stripe_secret_key, ""), timeout=30
        ) as stripe,
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api") as api,
    ):
        wallet = SandboxWallet(stores, stripe)
        app.dependency_overrides |= {
            runs.get_storefront: lambda: StorefrontClient(stores),
            runs.get_model: ScriptedProvider,
            runs.get_wallet: lambda: wallet,  # never Link, whatever .env says
        }

        response = await api.post(account.runs, json={"mode": "auto"}, headers=as_user(account))

        assert response.status_code == 200, response.text
        events = events_of(response)
        failed = [e for e in events if e["type"] == "error" or e.get("ok") is False]
        assert not failed, failed
        assert events[-1]["type"] == "done", events[-1]

        order_id = events[0]["order_id"]
        order = (await api.get(f"/api/orders/{order_id}", headers=as_user(account))).json()
        cart = (await api.get(account.cart, headers=as_user(account))).json()

        # What Stripe itself says about the payment the order points at.
        reference = order["payment_reference"]
        intent = await stripe.get(f"/v1/payment_intents/{reference}")
        assert intent.status_code == 200, intent.text

    # One payment, for exactly what the stores quoted.
    assert len(wallet.paid_cents) == 1
    assert (order["status"], order["total_cents"]) == ("placed", wallet.paid_cents[0])
    assert reference.startswith("pi_")
    assert (intent.json()["status"], intent.json()["amount"]) == ("succeeded", order["total_cents"])
    assert intent.json()["livemode"] is False

    # One order per store on that payment, every line saved, the cart emptied.
    lines = order["order_items"]
    assert len(lines) == 13 and len({line["store"] for line in lines}) == 3
    assert {line["payment_reference"] for line in lines} == {reference}
    assert all(line["grocery_item_id"] for line in lines)
    assert sum(line["line_total_cents"] for line in lines) == order["subtotal_cents"]
    assert order["subtotal_cents"] + order["delivery_fee_cents"] == order["total_cents"]
    assert cart["items"] == []

    stored = await service.table("orders").select("receipt").eq("id", order_id).execute()
    assert [p["payment_reference"] for p in stored.data[0]["receipt"]] == [reference]

    stores_paid = sorted({line["store"] for line in lines})
    print(f"\nPaid ${order['total_cents'] / 100:,.2f} in the Stripe sandbox: {reference}")
    print("  Find it under Payments in the Stripe sandbox dashboard.")
    print(f"  Order {order_id}: {len(lines)} lines from {', '.join(stores_paid)}")
    if KEEP_DATA:
        print(f"  kept in Supabase. Sign in as {account.email} / {PASSWORD}, or open Studio.")
