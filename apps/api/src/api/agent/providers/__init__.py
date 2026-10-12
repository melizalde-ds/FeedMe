import os

from api.agent.providers.base import ModelProvider, ProviderError
from api.settings import Settings


def get_provider(settings: Settings) -> ModelProvider:
    if settings.llm_provider == "scripted":
        from api.agent.providers.scripted import ScriptedProvider

        return ScriptedProvider()
    if not settings.bedrock_model_id:
        raise ProviderError("Set BEDROCK_MODEL_ID in .env to use LLM_PROVIDER=bedrock.")
    if settings.aws_bearer_token_bedrock:
        # The AWS SDK only reads a Bedrock API key from the environment, and the
        # settings file is not the environment.
        os.environ.setdefault("AWS_BEARER_TOKEN_BEDROCK", settings.aws_bearer_token_bedrock)
    from api.agent.providers.bedrock import BedrockProvider

    return BedrockProvider(settings.bedrock_model_id, settings.aws_region)
