from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI

from storefront.agent_api.router import router as agent_api_router
from storefront.catalog.loader import load_catalog
from storefront.checkout.payments import Payments
from storefront.checkout.router import router as checkout_router
from storefront.feeds.router import router as feeds_router
from storefront.pages.router import router as pages_router
from storefront.settings import Settings, get_settings


def create_app(
    data_dir: Path | None = None,
    settings: Settings | None = None,
    stripe_http: httpx.AsyncClient | None = None,
) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        if app.state.payments is not None:
            await app.state.payments.aclose()

    app = FastAPI(title="Mock Storefront", lifespan=lifespan)
    # Loaded up front so bad seed data stops the app from starting.
    app.state.catalog = load_catalog(data_dir or settings.data_dir)
    app.state.payments = (
        Payments(
            settings.stripe_secret_key, settings.stripe_profile_id, settings.realm, stripe_http
        )
        if settings.stripe_secret_key and settings.stripe_profile_id
        else None
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(agent_api_router)
    app.include_router(checkout_router)
    app.include_router(feeds_router)
    app.include_router(pages_router)
    return app


app = create_app()
