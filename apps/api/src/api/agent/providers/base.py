"""The model interface the agent loop talks to, in a provider-neutral shape."""

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ToolResult:
    call_id: str
    name: str
    # On failure this is {"error": "..."}, so the model can read it and recover.
    content: dict[str, Any]
    is_error: bool = False


@dataclass(frozen=True)
class UserMessage:
    content: str


@dataclass(frozen=True)
class AssistantMessage:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)


@dataclass(frozen=True)
class ToolResults:
    results: list[ToolResult]


Message = UserMessage | AssistantMessage | ToolResults


class ProviderError(Exception):
    """The model could not be reached or is not configured."""


class ModelProvider(Protocol):
    async def complete(
        self, system: str, messages: list[Message], tools: list[ToolSpec]
    ) -> AssistantMessage: ...
