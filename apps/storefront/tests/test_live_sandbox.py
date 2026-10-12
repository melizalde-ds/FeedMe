"""A real payment against the Stripe sandbox. Skipped unless you opt in:

    RUN_STRIPE_SANDBOX_TEST=1 uv run --package storefront pytest apps/storefront -k sandbox

Needs STRIPE_SECRET_KEY (sk_test_...) and STRIPE_PROFILE_ID (profile_test_...) in .env.
It creates one sandbox payment of about $12 covering two stores. No real card is involved.
"""

import os
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from mpp import Challenge, Credential

from storefront.main import create_app
from storefront.settings import Settings

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_STRIPE_SANDBOX_TEST") != "1",
    reason="set RUN_STRIPE_SANDBOX_TEST=1 to make a real Stripe sandbox payment",
)


def test_a_test_token_pays_a_store_in_the_stripe_sandbox():
    settings = Settings()
    assert settings.stripe_secret_key, "STRIPE_SECRET_KEY and STRIPE_PROFILE_ID must be in .env"

    # Stripe's test helper stands in for the buyer's wallet and grants a token.
    granted = httpx.post(
        "https://api.stripe.com/v1/test_helpers/shared_payment/granted_tokens",
        auth=(settings.stripe_secret_key, ""),
        headers={"Stripe-Version": "2026-09-30.preview"},
        data={
            "payment_method": "pm_card_visa",
            "usage_limits[currency]": "usd",
            "usage_limits[max_amount]": "2000",
            "usage_limits[expires_at]": str(int(time.time()) + 3600),
        },
        timeout=30,
    )
    assert granted.status_code == 200, granted.text
    spt = granted.json()["id"]

    url = "/api/checkout"
    eggs = [{"upc": "410020000223", "quantity": 2}]
    body = {"orders": [{"store": "walmart", "lines": eggs}, {"store": "target", "lines": eggs}]}
    with TestClient(create_app(settings=settings)) as client:
        probe = client.post(url, json=body)
        assert probe.status_code == 402, probe.text
        challenge = Challenge.from_www_authenticate(probe.headers["www-authenticate"])
        credential = Credential(challenge=challenge.to_echo(), payload={"spt": spt})
        paid = client.post(
            url, json=body, headers={"Authorization": credential.to_authorization()}
        )

    assert paid.status_code == 200, paid.text
    result = paid.json()
    assert result["total_cents"] == 578 + 624
    assert [order["store"] for order in result["orders"]] == ["walmart", "target"]
    assert result["payment_reference"].startswith("pi_")
