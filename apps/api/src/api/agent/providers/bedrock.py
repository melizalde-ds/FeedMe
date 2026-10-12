"""Amazon Bedrock through the Converse API. The model is whatever
BEDROCK_MODEL_ID names, so switching models is a settings change."""

import asyncio
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from api.agent.providers.base import (
    AssistantMessage,
    Message,
    ProviderError,
    ToolCall,
    ToolResults,
    ToolSpec,
    UserMessage,
)


def _to_converse(message: Message) -> dict[str, Any]:
    if isinstance(message, UserMessage):
        return {"role": "user", "content": [{"text": message.content}]}
    if isinstance(message, ToolResults):
        # No "status" field: Bedrock only accepts it for some models. Failures are
        # readable from the {"error": ...} content instead.
        return {
            "role": "user",
            "content": [
                {"toolResult": {"toolUseId": r.call_id, "content": [{"json": r.content}]}}
                for r in message.results
            ],
        }
    content: list[dict[str, Any]] = [{"text": message.text}] if message.text else []
    content += [
        {"toolUse": {"toolUseId": call.id, "name": call.name, "input": call.arguments}}
        for call in message.tool_calls
    ]
    return {"role": "assistant", "content": content}


class BedrockProvider:
    def __init__(self, model_id: str, region: str | None = None, client: Any = None) -> None:
        self._model_id = model_id
        try:
            self._client = client or boto3.client("bedrock-runtime", region_name=region)
        except BotoCoreError as exc:
            raise ProviderError(f"Bedrock is not configured: {exc}") from exc

    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AssistantMessage:
        request = {
            "modelId": self._model_id,
            "system": [{"text": system}],
            "messages": [_to_converse(message) for message in messages],
            "toolConfig": {
                "tools": [
                    {
                        "toolSpec": {
                            "name": tool.name,
                            "description": tool.description,
                            "inputSchema": {"json": tool.input_schema},
                        }
                    }
                    for tool in tools
                ]
            },
            "inferenceConfig": {"maxTokens": 4096, "temperature": 0},
        }
        try:
            # boto3 is blocking, so keep it off the event loop.
            response = await asyncio.to_thread(self._client.converse, **request)
        except (BotoCoreError, ClientError) as exc:
            raise ProviderError(f"Bedrock call failed: {exc}") from exc

        text, calls = [], []
        for block in response["output"]["message"]["content"]:
            if "text" in block:
                text.append(block["text"])
            elif "toolUse" in block:
                use = block["toolUse"]
                calls.append(ToolCall(use["toolUseId"], use["name"], use.get("input") or {}))
        return AssistantMessage("".join(text), calls)
