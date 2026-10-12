from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/storefront/seed: stores.yaml, products.csv, offers.csv.
DATA_DIR = Path(__file__).resolve().parents[2] / "seed"
# Repo-root .env, shared with apps/api.
ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="STOREFRONT_", env_file=ENV_FILE, extra="ignore", populate_by_name=True
    )

    data_dir: Path = DATA_DIR
    # Name the stores give in their payment challenges.
    realm: str = "feedme-mock-stores"

    # Stripe sandbox. All six stores charge the same sandbox account. Without
    # these, checkout prices a basket but can't take payment.
    stripe_secret_key: str | None = Field(default=None, validation_alias="STRIPE_SECRET_KEY")
    stripe_profile_id: str | None = Field(default=None, validation_alias="STRIPE_PROFILE_ID")

    @model_validator(mode="after")
    def _sandbox_only(self) -> Self:
        key, profile = self.stripe_secret_key, self.stripe_profile_id
        if bool(key) != bool(profile):
            raise ValueError("Set both STRIPE_SECRET_KEY and STRIPE_PROFILE_ID, or neither")
        # These are demo stores. A live key could charge a real card.
        if key and not key.startswith(("sk_test_", "rk_test_")):
            raise ValueError("STRIPE_SECRET_KEY must be a sandbox key (sk_test_...)")
        if profile and not profile.startswith("profile_test_"):
            raise ValueError("STRIPE_PROFILE_ID must be a sandbox profile (profile_test_...)")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
