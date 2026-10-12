"""Checkout for agents: one payment for baskets at one or more stores. The first
request gets HTTP 402 with the price; the same request repeated with a payment
credential gets the paid orders."""

import json
import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from mpp import Challenge
from mpp.errors import PaymentError, PaymentRequiredError
from pydantic import ValidationError

from storefront.checkout.payments import Payments
from storefront.checkout.schemas import CheckoutQuote, CheckoutRequest, Order, PaidCheckout
from storefront.checkout.service import CheckoutError, build_quote
from storefront.deps import CatalogDep

router = APIRouter(prefix="/api", tags=["checkout"])

PROBLEM_JSON = "application/problem+json"


def _payment_required(
    challenge: Challenge, realm: str, quote: CheckoutQuote, error: PaymentError | None = None
) -> Response:
    error = error or PaymentRequiredError(realm=realm, description=challenge.description)
    body = error.to_problem_details(challenge.id) | {"quote": quote.model_dump()}
    return Response(
        json.dumps(body),
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        media_type=PROBLEM_JSON,
        headers={
            "WWW-Authenticate": challenge.to_www_authenticate(realm),
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/checkout",
    response_model=PaidCheckout,
    responses={
        402: {"description": "Payment required. The body carries every store's quote."},
        409: {"description": "A store can't sell its part. The body names each one."},
    },
)
async def checkout(request: Request, catalog: CatalogDep) -> Response:
    # Read the raw bytes: the payment challenge is bound to exactly this body.
    raw = await request.body()
    try:
        baskets = CheckoutRequest.model_validate_json(raw)
    except ValidationError as exc:
        detail = exc.errors(include_url=False, include_context=False, include_input=False)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail) from exc
    try:
        quote = build_quote(catalog, baskets)
    except CheckoutError as exc:
        problems = [problem.model_dump() for problem in exc.problems]
        return JSONResponse(
            {"detail": str(exc), "problems": problems}, status_code=status.HTTP_409_CONFLICT
        )

    payments: Payments | None = request.app.state.payments
    if payments is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Payments are not configured. Set STRIPE_SECRET_KEY and STRIPE_PROFILE_ID in .env.",
        )

    items = sum(line.quantity for store in quote.stores for line in store.lines)
    names = ", ".join(catalog.stores[store.store].name for store in quote.stores)
    description = f"Grocery order from {names}: {items} item{'' if items == 1 else 's'}"
    try:
        result = await payments.charge(
            request.headers.get("authorization"), quote.total_cents, description, raw
        )
    except PaymentError as error:
        if isinstance(error.retry_challenge, Challenge):
            return _payment_required(error.retry_challenge, payments.realm, quote, error)
        return Response(
            json.dumps(error.to_problem_details()),
            status_code=error.status,
            media_type=PROBLEM_JSON,
        )
    if isinstance(result, Challenge):
        return _payment_required(result, payments.realm, quote)

    # One payment, one order per store.
    _, receipt = result
    paid = PaidCheckout(
        orders=[
            Order(
                **store.model_dump(),
                order_id=f"ord_{uuid.uuid4().hex[:12]}",
                payment_reference=receipt.reference,
            )
            for store in quote.stores
        ],
        total_cents=quote.total_cents,
        payment_reference=receipt.reference,
    )
    return Response(
        paid.model_dump_json(),
        media_type="application/json",
        headers={"Payment-Receipt": receipt.to_payment_receipt()},
    )
