import pytest
from botocore.exceptions import ClientError

from api.agent.providers import get_provider
from api.agent.providers.base import (
    AssistantMessage,
    ProviderError,
    ToolCall,
    ToolResult,
    ToolResults,
    ToolSpec,
    UserMessage,
)
from api.agent.providers.bedrock import BedrockProvider
from api.agent.providers.scripted import ScriptedProvider
from api.settings import Settings

pytestmark = pytest.mark.anyio

TOOLS = [ToolSpec("search_products", "Search.", {"type": "object", "properties": {}})]


class FakeBedrock:
    """Stands in for boto3's bedrock-runtime client. No real call is made."""

    def __init__(self, response=None, error=None):
        self.requests = []
        self._response = response
        self._error = error

    def converse(self, **request):
        self.requests.append(request)
        if self._error:
            raise self._error
        return self._response


def reply(*content):
    return {"output": {"message": {"role": "assistant", "content": list(content)}}}


async def test_request_is_translated_to_the_converse_format():
    client = FakeBedrock(reply({"text": "ok"}))
    provider = BedrockProvider("some.model-id", client=client)
    history = [
        UserMessage("list"),
        AssistantMessage("Searching.", [ToolCall("t1", "search_products", {"query": "eggs"})]),
        ToolResults([
            ToolResult("t1", "search_products", {"products": []}),
            ToolResult("t2", "add_to_cart", {"error": "nope"}, is_error=True),
        ]),
    ]
    await provider.complete("system text", history, TOOLS)

    (request,) = client.requests
    assert request["modelId"] == "some.model-id"
    assert request["system"] == [{"text": "system text"}]
    assert request["messages"] == [
        {"role": "user", "content": [{"text": "list"}]},
        {
            "role": "assistant",
            "content": [
                {"text": "Searching."},
                {"toolUse": {"toolUseId": "t1", "name": "search_products",
                             "input": {"query": "eggs"}}},
            ],
        },
        {
            "role": "user",
            "content": [
                {"toolResult": {"toolUseId": "t1", "content": [{"json": {"products": []}}]}},
                {"toolResult": {"toolUseId": "t2", "content": [{"json": {"error": "nope"}}]}},
            ],
        },
    ]
    assert request["toolConfig"]["tools"] == [
        {"toolSpec": {"name": "search_products", "description": "Search.",
                      "inputSchema": {"json": {"type": "object", "properties": {}}}}}
    ]


async def test_tool_use_in_the_reply_becomes_tool_calls():
    client = FakeBedrock(
        reply(
            {"text": "Let me look."},
            {"toolUse": {"toolUseId": "a", "name": "search_products", "input": {"query": "eggs"}}},
            {"toolUse": {"toolUseId": "b", "name": "view_cart", "input": {}}},
        )
    )
    turn = await BedrockProvider("m", client=client).complete("s", [UserMessage("x")], TOOLS)
    assert turn.text == "Let me look."
    assert turn.tool_calls == [
        ToolCall("a", "search_products", {"query": "eggs"}),
        ToolCall("b", "view_cart", {}),
    ]


async def test_an_assistant_turn_with_only_tool_calls_has_no_empty_text_block():
    client = FakeBedrock(reply({"text": "ok"}))
    history = [UserMessage("x"), AssistantMessage(tool_calls=[ToolCall("a", "view_cart", {})])]
    await BedrockProvider("m", client=client).complete("s", history, TOOLS)
    assert client.requests[0]["messages"][1]["content"] == [
        {"toolUse": {"toolUseId": "a", "name": "view_cart", "input": {}}}
    ]


async def test_aws_errors_become_provider_errors():
    denied = ClientError({"Error": {"Code": "AccessDeniedException", "Message": "no"}}, "Converse")
    provider = BedrockProvider("m", client=FakeBedrock(error=denied))
    with pytest.raises(ProviderError, match="AccessDeniedException"):
        await provider.complete("s", [UserMessage("x")], TOOLS)


def settings(**overrides):
    return Settings(
        _env_file=None,
        supabase_jwt_secret="x",
        supabase_anon_key="x",
        supabase_service_role_key="x",
        **overrides,
    )


def test_scripted_is_the_default_provider():
    assert isinstance(get_provider(settings()), ScriptedProvider)


def test_bedrock_needs_a_model_id():
    with pytest.raises(ProviderError, match="BEDROCK_MODEL_ID"):
        get_provider(settings(llm_provider="bedrock"))
