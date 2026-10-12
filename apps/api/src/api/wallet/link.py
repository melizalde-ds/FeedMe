"""Pays a store's checkout through Stripe's Link CLI, over its MCP server.

Link holds the user's cards. It asks the user to approve each payment in the Link
app, then pays the store with a one-time token, so no card number reaches this
program or the model.
"""

import asyncio
import json
import shlex
from collections.abc import Callable
from typing import Any, Protocol

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# The Link MCP server exposes its commands behind a few general tools. This one
# runs any command that isn't read-only, which covers both commands used here.
RUN_COMMAND = "call_write_tool"

# Spend-request states that mean the user hasn't decided yet.
WAITING = {"created", "pending_approval"}


class WalletError(Exception):
    pass


class ToolCaller(Protocol):
    async def call_tool(self, name: str, arguments: dict[str, Any], timeout: float) -> Any: ...


class LinkMcp:
    """The Link CLI's MCP server as a child process, started on first use.

    One task owns the connection from start to close, because the MCP client
    can't be opened in one task and closed in another. Calls are handed to it.
    """

    def __init__(self, command: str) -> None:
        self._command = shlex.split(command)
        self._jobs: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._ready: asyncio.Future | None = None

    async def call_tool(self, name: str, arguments: dict[str, Any], timeout: float) -> Any:
        if self._task is None:
            self._ready = asyncio.get_running_loop().create_future()
            self._task = asyncio.create_task(self._serve(self._ready))
        await self._ready
        if self._task.done():
            raise WalletError("The Link CLI stopped running")
        done = asyncio.get_running_loop().create_future()
        await self._jobs.put((name, arguments, timeout, done))
        return await done

    async def _serve(self, ready: asyncio.Future) -> None:
        params = StdioServerParameters(command=self._command[0], args=self._command[1:])
        try:
            async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
                await session.initialize()
                ready.set_result(None)
                while (job := await self._jobs.get()) is not None:
                    name, arguments, timeout, done = job
                    try:
                        result = await session.call_tool(
                            name, arguments, read_timeout_seconds=timeout
                        )
                    except Exception as exc:  # reported to the caller, not lost in this task
                        done.set_exception(WalletError(f"The Link CLI call failed: {exc}"))
                    else:
                        done.set_result(result)
        except Exception as exc:
            # The MCP client wraps startup failures in exception groups.
            while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
                exc = exc.exceptions[0]
            if not ready.done():
                ready.set_exception(
                    WalletError(f"Could not start the Link CLI ({self._command[0]}): {exc!r}")
                )
        finally:
            # Don't leave callers waiting on a connection that is gone.
            while not self._jobs.empty():
                job = self._jobs.get_nowait()
                if job is not None and not job[3].done():
                    job[3].set_exception(WalletError("The Link CLI stopped running"))

    async def aclose(self) -> None:
        if self._task is not None:
            await self._jobs.put(None)
            await self._task
            self._task = None


def _parse(result: Any) -> list[dict[str, Any]]:
    """A command's output as a list of JSON objects. Commands that report progress
    return a list, others a single object, sometimes followed by suggestion text."""
    text = "".join(block.text for block in result.content if getattr(block, "text", None))
    if result.is_error:
        hint = ""
        if "authenticat" in text.lower():
            hint = " Log in once with: npx @stripe/link-cli auth login"
        raise WalletError(f"Link refused: {text.strip() or 'no details'}.{hint}")
    try:
        data, _ = json.JSONDecoder().raw_decode(text.lstrip())
    except ValueError:
        raise WalletError(f"Unexpected reply from the Link CLI: {text[:200]!r}") from None
    chunks = data if isinstance(data, list) else [data]
    if not chunks or not all(isinstance(chunk, dict) for chunk in chunks):
        raise WalletError(f"Unexpected reply from the Link CLI: {text[:200]!r}")
    return chunks


def _approved_challenge(spend_request: dict[str, Any]) -> str:
    """The store's challenge the user is approving, which Link wants back when
    paying so it can refuse if the store has changed the price since."""
    args = ((spend_request.get("_next") or {}).get("pay_argv") or {}).get("args") or []
    try:
        return args[args.index("--approved-challenge") + 1]
    except (ValueError, IndexError):
        raise WalletError("Link did not say how to continue the payment") from None


class LinkWallet:
    def __init__(
        self, mcp: ToolCaller, *, approval_timeout: float = 600.0, poll_seconds: float = 3.0
    ) -> None:
        self._mcp = mcp
        self.approval_timeout = approval_timeout
        self._poll_seconds = poll_seconds

    async def _run(self, command: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = await self._mcp.call_tool(
            RUN_COMMAND, {"name": command, "arguments": arguments}, timeout=90.0
        )
        return _parse(result)[-1]

    async def pay(
        self, url: str, body: str, context: str, approval_needed: Callable[[str | None], None]
    ) -> str:
        """Pays the checkout at url and returns the store's reply to the paid request.

        The amount is whatever the store's 402 challenge asks for; Link shows it
        to the user for approval. Always test mode: this never charges a real card.
        """
        request = {"url": url, "method": "POST", "data": body, "header": [], "test": True}
        reply = await self._run("mpp_pay", request | {"context": context})

        if "_next" in reply or reply.get("status") in WAITING:
            challenge = _approved_challenge(reply)
            approval_needed(reply.get("approval_url"))
            status = await self._wait_for_approval(reply["id"])
            if status != "approved":
                raise WalletError(f"The payment was not approved in Link (status: {status})")
            reply = await self._run(
                "mpp_pay",
                request | {"spendRequestId": reply["id"], "approvedChallenge": challenge},
            )

        if reply.get("status") != 200:
            raise WalletError(
                f"The store did not accept the payment (HTTP {reply.get('status')}): "
                f"{str(reply.get('body'))[:300]}"
            )
        return reply["body"]

    async def _wait_for_approval(self, spend_request_id: str) -> str:
        """Checks in short calls so no single call outlives a client timeout."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.approval_timeout
        while True:
            spend_request = await self._run(
                "spend-request_retrieve",
                {
                    "id": spend_request_id,
                    "timeout": 30,
                    "interval": 0,
                    "maxAttempts": 0,
                    "include": [],
                    "force": False,
                },
            )
            status = str(spend_request.get("status"))
            if status not in WAITING:
                return status
            if loop.time() + self._poll_seconds > deadline:
                raise WalletError(
                    f"No approval in Link after {self.approval_timeout:g}s. Nothing was charged."
                )
            await asyncio.sleep(self._poll_seconds)
