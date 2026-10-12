"""Takes payment with the Machine Payments Protocol: the store answers 402 with
what to pay, and the buyer retries with a one-time Stripe shared payment token.
No card number ever reaches the store."""

import base64
import hashlib
import hmac

import httpx
from mpp import Challenge, Credential, Receipt
from mpp.methods.stripe import ChargeIntent, stripe
from mpp.server import Mpp

# Shared payment tokens are a preview feature, so Stripe needs the preview
# version named on the PaymentIntent call. This is the one Stripe's Node SDK sends.
STRIPE_API_VERSION = "2026-07-29.preview"


def _signing_key(secret_key: str) -> str:
    """Key that signs payment challenges, derived from the Stripe key the way
    Stripe's own example does, so there is no second secret to manage."""
    digest = hmac.new(secret_key.encode(), b"mpp-challenge-signing", hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


class Payments:
    def __init__(
        self,
        secret_key: str,
        profile_id: str,
        realm: str,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.realm = realm
        self._http = http or httpx.AsyncClient(timeout=30)
        self._http.headers["Stripe-Version"] = STRIPE_API_VERSION
        self._mpp = Mpp.create(
            method=stripe(
                network_id=profile_id,
                payment_method_types=["card"],
                currency="usd",
                decimals=2,
                recipient=profile_id,
                intents={"charge": ChargeIntent(secret_key=secret_key, http_client=self._http)},
            ),
            realm=realm,
            secret_key=_signing_key(secret_key),
        )

    async def charge(
        self, authorization: str | None, total_cents: int, description: str, body: bytes
    ) -> Challenge | tuple[Credential, Receipt]:
        """A challenge when payment is still needed, or the receipt once it is paid.

        The request body is bound into the challenge, so a token approved for one
        set of baskets can't pay for a different one.
        """
        return await self._mpp.charge(
            authorization,
            f"{total_cents / 100:.2f}",
            description=description,
            body=body,
        )

    async def aclose(self) -> None:
        await self._http.aclose()
