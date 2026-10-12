"""Test doubles for the payment path: a fake Stripe, and a fake Link MCP server
that pays the real storefront code the way the Link CLI does."""

import json

import httpx
from mcp.types import CallToolResult, TextContent
from mpp import Challenge, Credential
from storefront.main import create_app
from storefront.settings import Settings


class FakeStripe:
    """Stands in for api.stripe.com and approves every charge. No real call is made."""

    def __init__(self):
        self.charges = []  # amounts in cents

    def __call__(self, request: httpx.Request) -> httpx.Response:
        form = dict(httpx.QueryParams(request.content.decode()))
        self.charges.append(int(form["amount"]))
        return httpx.Response(
            200, json={"id": f"pi_test_{len(self.charges)}", "status": "succeeded"}
        )


def storefront_app(stripe: FakeStripe | None):
    """The real storefront. With a FakeStripe it has sandbox keys set; without, none."""
    if stripe is None:
        return create_app(settings=Settings(_env_file=None))
    settings = Settings(
        _env_file=None, stripe_secret_key="sk_test_abc", stripe_profile_id="profile_test_abc"
    )
    return create_app(
        settings=settings,
        stripe_http=httpx.AsyncClient(transport=httpx.MockTransport(stripe)),
    )


def reply(payload, *, is_error=False) -> CallToolResult:
    """A tool result of the MCP library's own type, as the real client returns."""
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return CallToolResult(content=[TextContent(type="text", text=text)], is_error=is_error)


class FakeLink:
    """Behaves like the Link CLI's MCP server for the two commands the wallet uses.

    mpp_pay asks the store for its price and opens a spend request; once that is
    approved, a second mpp_pay pays the store with a one-time token.
    """

    def __init__(self, http: httpx.AsyncClient, *, decisions=("pending_approval", "approved")):
        self._http = http
        self._decisions = list(decisions)
        self.calls = []  # (command, arguments)
        self.logged_in = True

    async def call_tool(self, name, arguments, timeout):
        assert name == "call_write_tool"
        command, args = arguments["name"], arguments["arguments"]
        self.calls.append((command, args))
        if command == "spend-request_retrieve":
            status = self._decisions.pop(0) if len(self._decisions) > 1 else self._decisions[0]
            return reply({"id": args["id"], "status": status})
        assert command == "mpp_pay"

        probe = await self._http.post(args["url"], content=args["data"])
        if probe.status_code != 402:
            return reply([{"status": probe.status_code, "headers": {}, "body": probe.text}])
        if not self.logged_in:
            return reply("Not authenticated. Run `link-cli auth login`.", is_error=True)
        header = probe.headers["www-authenticate"]

        if "spendRequestId" not in args:
            spend_id = f"lsrq_{len(self.calls)}"
            next_args = ["pay", args["url"], "--spend-request-id", spend_id]
            next_args += ["--approved-challenge", header, "-X", "POST", "-d", args["data"]]
            return reply([
                {
                    "id": spend_id,
                    "status": "pending_approval",
                    "approval_url": f"https://app.link.com/approve/{spend_id}",
                    "_next": {"pay_argv": {"command": "mpp", "args": next_args}},
                }
            ])

        # As the CLI does: refuse if the store's challenge changed since approval.
        def comparable(value):
            c = Challenge.from_www_authenticate(value)
            return (c.realm, c.method, c.intent, c.request, c.digest, c.description)

        if comparable(header) != comparable(args["approvedChallenge"]):
            return reply("MPP challenge changed after approval", is_error=True)
        challenge = Challenge.from_www_authenticate(header)
        credential = Credential(challenge=challenge.to_echo(), payload={"spt": "spt_test_1"})
        paid = await self._http.post(
            args["url"],
            content=args["data"],
            headers={"Authorization": credential.to_authorization()},
        )
        return reply([{"status": paid.status_code, "headers": {}, "body": paid.text}])

    def commands(self):
        return [command for command, _ in self.calls]
