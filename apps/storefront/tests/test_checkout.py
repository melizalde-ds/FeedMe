import base64
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient
from mpp import Challenge, Credential, Receipt
from pydantic import ValidationError

from storefront.catalog.models import Offer, Product, Store
from storefront.catalog.service import Catalog
from storefront.checkout.schemas import CheckoutRequest
from storefront.checkout.service import CheckoutError, build_quote
from storefront.main import create_app
from storefront.settings import Settings

URL = "/api/checkout"
EGGS = "410020000223"  # $2.89 at Walmart, $3.32 at QuickCart
ASPARAGUS = "410010000011"  # $3.99 at Walmart
SALMON = "410040000326"  # out of stock at Walmart
CLUB_EGGS = "410020000865"  # $6.50 at BulkBarn Club, which has a $50 minimum


def basket(**stores):
    """basket(walmart=[(EGGS, 2)]) -> the checkout body. Use _ for - in store slugs."""
    return {
        "orders": [
            {
                "store": store.replace("_", "-"),
                "lines": [{"upc": upc, "quantity": quantity} for upc, quantity in lines],
            }
            for store, lines in stores.items()
        ]
    }


class FakeStripe:
    """Stands in for api.stripe.com. No real call is made."""

    def __init__(self):
        self.requests = []
        self.response = httpx.Response(200, json={"id": "pi_test_123", "status": "succeeded"})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.response


@pytest.fixture
def stripe():
    return FakeStripe()


@pytest.fixture
def paid(stripe):
    """A storefront with sandbox keys set and Stripe faked."""
    settings = Settings(
        _env_file=None, stripe_secret_key="sk_test_abc", stripe_profile_id="profile_test_abc"
    )
    http = httpx.AsyncClient(transport=httpx.MockTransport(stripe))
    return TestClient(create_app(settings=settings, stripe_http=http))


def challenge_from(response) -> Challenge:
    return Challenge.from_www_authenticate(response.headers["www-authenticate"])


def pay(client, body, challenge, spt="spt_test_123"):
    credential = Credential(challenge=challenge.to_echo(), payload={"spt": spt})
    return client.post(URL, json=body, headers={"Authorization": credential.to_authorization()})


# --- pricing -----------------------------------------------------------------


def test_first_request_gets_402_with_one_price_for_every_store(paid):
    body = basket(walmart=[(EGGS, 2), (ASPARAGUS, 1)], quickcart=[(EGGS, 1)])
    response = paid.post(URL, json=body)

    assert response.status_code == 402
    quote = response.json()["quote"]
    walmart, quickcart = quote["stores"]
    assert (walmart["store"], walmart["subtotal_cents"], walmart["total_cents"]) == (
        "walmart",
        977,
        977,
    )
    # Each store still adds its own delivery fee.
    assert (quickcart["delivery_fee_cents"], quickcart["total_cents"]) == (599, 332 + 599)
    assert quote["total_cents"] == 977 + 931

    challenge = challenge_from(response)
    assert (challenge.method, challenge.intent) == ("stripe", "charge")
    assert challenge.request["amount"] == str(977 + 931)  # one charge for the lot
    assert challenge.request["currency"] == "usd"
    assert challenge.request["methodDetails"] == {
        "networkId": "profile_test_abc",
        "paymentMethodTypes": ["card"],
    }
    assert challenge.description == "Grocery order from Walmart, QuickCart: 4 items"


def test_challenge_is_the_same_on_a_second_look(paid):
    # After the user approves, the Link CLI asks the store again and refuses to pay
    # if anything but the challenge's id and expiry has changed.
    def comparable(response):
        c = challenge_from(response)
        return (c.realm, c.method, c.intent, c.request, c.digest, c.description, c.opaque)

    body = basket(walmart=[(EGGS, 2)], target=[(EGGS, 1)])
    assert comparable(paid.post(URL, json=body)) == comparable(paid.post(URL, json=body))


def test_every_store_that_cannot_sell_is_named_and_nothing_is_charged(paid, stripe):
    body = basket(
        walmart=[(SALMON, 1)],  # out of stock
        bulkbarn_club=[(CLUB_EGGS, 1)],  # under the $50 minimum
        target=[(EGGS, 1)],  # fine
        quickcart=[("400000000000", 1)],  # not a product
        corner_shop=[(EGGS, 1)],  # not a store
    )
    response = paid.post(URL, json=body)

    assert response.status_code == 409
    assert "www-authenticate" not in response.headers
    problems = {p["store"]: p["detail"] for p in response.json()["problems"]}
    assert set(problems) == {"walmart", "bulkbarn-club", "quickcart", "corner-shop"}
    assert "out of stock" in problems["walmart"]
    assert "$50.00 order minimum" in problems["bulkbarn-club"]
    assert "does not sell" in problems["quickcart"]
    assert problems["corner-shop"] == "Unknown store"
    assert stripe.requests == []


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (basket(walmart=[(EGGS, 1), (EGGS, 2)]), "only once"),
        ({"orders": [basket(walmart=[(EGGS, 1)])["orders"][0]] * 2}, "store can appear only once"),
    ],
)
def test_repeated_products_or_stores_are_refused(paid, stripe, body, message):
    response = paid.post(URL, json=body)
    assert response.status_code == 409
    assert message in str(response.json())
    assert stripe.requests == []


@pytest.mark.parametrize(
    "body",
    [{"orders": []}, basket(walmart=[]), basket(walmart=[(EGGS, 0)]), {"lines": []}],
)
def test_malformed_requests_are_rejected(paid, body):
    assert paid.post(URL, json=body).status_code == 422


def test_the_old_per_store_checkout_is_gone(paid):
    response = paid.post("/api/stores/walmart/checkout", json=basket(walmart=[(EGGS, 1)]))
    assert response.status_code == 404


def test_the_card_minimum_applies_to_the_combined_total():
    shop = Store(slug="s", name="Shop", delivery_fee_cents=0, order_minimum_cents=0)
    other = Store(slug="o", name="Other", delivery_fee_cents=0, order_minimum_cents=0)
    gum = Product(
        upc="400000000017",
        name="Gum",
        brand="B",
        category="pantry",
        size_value=1,
        size_unit="count",
        equivalence_group="gum",
    )
    offers = {
        slug: {gum.upc: Offer(store=slug, upc=gum.upc, price_cents=30, in_stock=True)}
        for slug in ("s", "o")
    }
    catalog = Catalog({"s": shop, "o": other}, {gum.upc: gum}, offers)

    with pytest.raises(CheckoutError, match="at least \\$0.50"):
        build_quote(catalog, CheckoutRequest.model_validate(basket(s=[(gum.upc, 1)])))
    # 30 cents at each of two stores is enough together.
    both = basket(s=[(gum.upc, 1)], o=[(gum.upc, 1)])
    assert build_quote(catalog, CheckoutRequest.model_validate(both)).total_cents == 60


# --- paying ------------------------------------------------------------------


def test_one_payment_creates_an_order_for_each_store(paid, stripe):
    body = basket(quickcart=[(EGGS, 2)], walmart=[(ASPARAGUS, 1)])
    total = (2 * 332 + 599) + 399
    challenge = challenge_from(paid.post(URL, json=body))

    response = pay(paid, body, challenge)

    assert response.status_code == 200
    result = response.json()
    assert (result["total_cents"], result["payment_reference"]) == (total, "pi_test_123")
    quickcart, walmart = result["orders"]
    assert (quickcart["store"], quickcart["total_cents"]) == ("quickcart", 2 * 332 + 599)
    assert (walmart["store"], walmart["total_cents"]) == ("walmart", 399)
    # Separate order numbers, one shared payment.
    assert quickcart["order_id"] != walmart["order_id"]
    assert all(order["order_id"].startswith("ord_") for order in result["orders"])
    assert {order["payment_reference"] for order in result["orders"]} == {"pi_test_123"}
    assert {order["status"] for order in result["orders"]} == {"paid"}
    receipt = Receipt.from_payment_receipt(response.headers["payment-receipt"])
    assert (receipt.status, receipt.method, receipt.reference) == (
        "success",
        "stripe",
        "pi_test_123",
    )

    (request,) = stripe.requests
    assert str(request.url) == "https://api.stripe.com/v1/payment_intents"
    assert request.headers["authorization"] == "Basic " + base64.b64encode(b"sk_test_abc:").decode()
    assert request.headers["stripe-version"] == "2026-07-29.preview"
    form = {key: values[0] for key, values in parse_qs(request.content.decode()).items()}
    assert form["amount"] == str(total)
    assert form["currency"] == "usd"
    assert form["confirm"] == "true"
    assert form["shared_payment_granted_token"] == "spt_test_123"


@pytest.mark.parametrize(
    "other",
    [basket(walmart=[(EGGS, 9)]), basket(walmart=[(EGGS, 1)], target=[(EGGS, 5)])],
)
def test_a_credential_cannot_pay_for_a_different_basket(paid, stripe, other):
    challenge = challenge_from(paid.post(URL, json=basket(walmart=[(EGGS, 1)])))

    response = pay(paid, other, challenge)

    assert response.status_code == 402
    assert stripe.requests == []


def test_a_credential_cannot_pay_at_a_different_price(paid, stripe):
    body = basket(walmart=[(EGGS, 1)])
    challenge = challenge_from(paid.post(URL, json=body))
    cheaper = Challenge(
        id=challenge.id,
        method=challenge.method,
        intent=challenge.intent,
        request={**challenge.request, "amount": "1"},
        realm=challenge.realm,
        digest=challenge.digest,
        expires=challenge.expires,
        description=challenge.description,
    )

    response = pay(paid, body, cheaper)

    assert response.status_code == 402
    assert stripe.requests == []


def test_a_declined_payment_creates_no_order_and_can_be_retried(paid, stripe):
    body = basket(walmart=[(EGGS, 1)])
    challenge = challenge_from(paid.post(URL, json=body))
    stripe.response = httpx.Response(402, json={"error": {"message": "Your card was declined."}})

    response = pay(paid, body, challenge)

    assert response.status_code == 402
    assert "orders" not in response.json()
    assert "declined" in response.json()["detail"]
    assert challenge_from(response).request["amount"] == "289"  # a fresh challenge to retry


# --- configuration -----------------------------------------------------------


def test_without_keys_checkout_still_validates_but_cannot_charge(client):
    bad = client.post(URL, json=basket(walmart=[(SALMON, 1)]))
    assert bad.status_code == 409

    response = client.post(URL, json=basket(walmart=[(EGGS, 1)]))
    assert response.status_code == 503
    assert "STRIPE_SECRET_KEY" in response.json()["detail"]


@pytest.mark.parametrize(
    ("key", "profile", "message"),
    [
        ("sk_live_abc", "profile_test_abc", "sandbox key"),
        ("sk_test_abc", "profile_abc", "sandbox profile"),
        ("sk_test_abc", None, "both"),
        (None, "profile_test_abc", "both"),
    ],
)
def test_only_a_complete_sandbox_configuration_is_accepted(key, profile, message):
    with pytest.raises(ValidationError, match=message):
        Settings(_env_file=None, stripe_secret_key=key, stripe_profile_id=profile)
