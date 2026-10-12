from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo-root .env, written by scripts/gen-env.py.
ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # Kong gateway from docker-compose.yaml.
    supabase_url: str = "http://localhost:54321"
    supabase_jwt_secret: str
    supabase_anon_key: str
    supabase_service_role_key: str

    # Mock stores (apps/storefront).
    storefront_url: str = "http://localhost:8100"

    # Recipes, loaded into Qdrant by scripts/ingest_recipes.py.
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "recipes"

    # Shopping agent. "scripted" runs offline with no model.
    llm_provider: Literal["scripted", "bedrock"] = "scripted"
    # Required for the bedrock provider. There is no default model.
    bedrock_model_id: str | None = None
    aws_region: str | None = None
    # A Bedrock API key. Optional: without it, the usual AWS credentials are used.
    aws_bearer_token_bedrock: str | None = None
    agent_max_steps: int = 25
    agent_tool_timeout_seconds: float = 10.0

    # Meal planner (api.meals). The search text is embedded with the model the
    # recipes were loaded with: both must match scripts/ingest_recipes.py.
    bedrock_embed_model_id: str = "amazon.titan-embed-text-v2:0"
    embed_dimensions: int = 1024
    # The model that writes the searches. Leave out to use BEDROCK_MODEL_ID.
    # With LLM_PROVIDER=scripted no model is asked and fixed searches are used.
    meal_query_model_id: str | None = None
    # A TypeSafe API key, for the Jev allergen check. Without it no meal can be
    # checked, so none is suggested.
    jev_api: str | None = None
    # Pinned, so a new model version can't change what counts as safe unnoticed.
    jev_model: str = "jev-1.13.0"
    # A recipe is dropped when Jev's probability that it has an allergen, or
    # breaks a diet, is at or above these. Tried on 2026-10-10 with a household
    # avoiding five allergens: hidden allergens scored 0.39 and up, and of the
    # recipes the word lists passed, 0.15 dropped 48%, 0.2 36% and 0.3 25%.
    allergen_block_probability: float = 0.2
    diet_block_probability: float = 0.4
    # Different dishes searched per meal type. Each is one embedding call, and
    # they set how long a request takes: this Bedrock key allowed about 0.6 a
    # second on 2026-10-10, so three meal types of 4 take 18 to 27 s. Raise it
    # for more variety once the quota allows.
    meal_ideas: int = 4
    # Recipes kept per meal type after merging the searches, recipes sent to
    # Jev at a time, and meal options kept per meal type.
    meal_candidates: int = 50
    meal_check_batch: int = 15
    meal_options: int = 10
    # How long a meal the user was shown stays out of new suggestions.
    cooling_days: int = 14
    # "Low carb": at most this share of a recipe's calories from carbohydrates.
    low_carb_max_share: float = 0.26

    # Paying the stores through Stripe's Link CLI (its MCP server). Test mode is
    # forced in code. Needs Node, and `npx @stripe/link-cli auth login` done once.
    payments_enabled: bool = True
    # The version is pinned on purpose: this program can move money.
    link_mcp_command: str = "npx -y @stripe/link-cli@0.27.0 --mcp"
    # How long to wait for the user to approve a payment in the Link app.
    link_approval_timeout_seconds: float = 600.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
