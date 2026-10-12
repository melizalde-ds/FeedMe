"""Offline stand-in for a model. It follows a fixed script through the same tools
and loop as a real model: search every item, plan the basket, add it to the cart,
and pay for it when a wallet is connected."""

import json

from api.agent.providers.base import (
    AssistantMessage,
    Message,
    ToolCall,
    ToolResult,
    ToolResults,
    ToolSpec,
    UserMessage,
)


def _results(messages: list[Message], tool: str) -> list[ToolResult]:
    return [
        result
        for message in messages
        if isinstance(message, ToolResults)
        for result in message.results
        if result.name == tool
    ]


class ScriptedProvider:
    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AssistantMessage:
        first = messages[0]
        assert isinstance(first, UserMessage)
        names = [item["name"] for item in json.loads(first.content)["shopping_list"]]

        searches = _results(messages, "search_products")
        if not searches:
            calls = [
                ToolCall(f"search-{i}", "search_products", {"query": name})
                for i, name in enumerate(names)
            ]
            return AssistantMessage("Searching the stores for each item.", calls)

        # The top hit for each item, and whether every word of the item matched it.
        picks: dict[str, tuple[str, bool]] = {}
        for result in searches:
            products = result.content.get("products") or []
            if result.is_error or not products:
                continue
            top = products[0]
            name = names[int(result.call_id.removeprefix("search-"))]
            picks[name] = (top["upc"], top["match"]["matched"] == top["match"]["of"])

        plans = _results(messages, "plan_basket")
        if not plans:
            if not picks:
                return AssistantMessage("I couldn't find any of the items in the stores.")
            items = [{"ingredient": name, "upc": upc} for name, (upc, _) in picks.items()]
            return AssistantMessage(
                "Working out the cheapest basket.",
                [ToolCall("plan", "plan_basket", {"items": items})],
            )

        if plans[-1].is_error:
            return AssistantMessage(f"I couldn't plan the basket: {plans[-1].content['error']}")

        added = _results(messages, "add_to_cart")
        lines = plans[-1].content["cheapest"]["lines"]
        if not added and lines:
            items = [
                {
                    "ingredient": line["ingredient"],
                    "store": line["store"],
                    "upc": line["upc"],
                    "sure": picks[line["ingredient"]][1],
                }
                for line in lines
            ]
            return AssistantMessage(
                "Saving the cheapest basket.", [ToolCall("add", "add_to_cart", {"items": items})]
            )

        matched = f"I matched {len(lines)} of {len(names)} items on the list."
        if not any(tool.name == "checkout" for tool in tools) or not added:
            return AssistantMessage(f"Done. {matched}")

        payments = _results(messages, "checkout")
        if not payments:
            if added[-1].content.get("added"):
                return AssistantMessage(
                    "Paying for the basket. Approve the payment in Link.",
                    [ToolCall("checkout", "checkout", {})],
                )
            return AssistantMessage(f"Done. {matched} Nothing to pay.")

        result = payments[-1].content
        if payments[-1].is_error:
            return AssistantMessage(f"Done. {matched} Not paid: {result['error']}")
        total = f"${result['total_cents'] / 100:,.2f}"
        stores = len(result["orders"])
        outcome = f"Paid {total} for {stores} store{'' if stores == 1 else 's'} in one payment."
        skipped = "; ".join(f"{store}: {why}" for store, why in result["not_paid"].items())
        return AssistantMessage(
            f"Done. {matched} {outcome}" + (f" Not paid: {skipped}" if skipped else "")
        )
