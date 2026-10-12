import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from api.household.router import router as household_router
from api.meals.router import router as meals_router
from api.meals.services import MealServices
from api.runs.router import router as runs_router
from api.settings import Settings, get_settings
from api.wallet.link import LinkMcp, LinkWallet


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config = settings or get_settings()
        # Starts the Link CLI on the first payment, not here.
        link = LinkMcp(config.link_mcp_command)
        app.state.wallet = (
            LinkWallet(link, approval_timeout=config.link_approval_timeout_seconds)
            if config.payments_enabled
            else None
        )
        async with (
            # Shared by every Supabase client (api.db).
            httpx.AsyncClient() as http,
            httpx.AsyncClient(base_url=config.storefront_url) as storefront_http,
            httpx.AsyncClient(base_url=config.qdrant_url) as recipes_http,
        ):
            app.state.http = http
            app.state.storefront_http = storefront_http
            app.state.recipes_http = recipes_http
            app.state.meals = meals = MealServices(config, recipes_http)
            try:
                yield
            finally:
                await meals.aclose()
                # Runs still going are left as 'shopping' in the database and
                # closed as failed when the user starts the next one.
                runs = list(app.state.runs)
                for run in runs:
                    run.cancel()
                await asyncio.gather(*runs, return_exceptions=True)
                await link.aclose()

    app = FastAPI(title="FeedMe API", lifespan=lifespan)
    # Shopping runs in progress. Held here so they aren't garbage collected.
    app.state.runs = set()
    if settings is not None:
        app.dependency_overrides[get_settings] = lambda: settings

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(runs_router)
    app.include_router(meals_router)
    app.include_router(household_router)
    return app


app = create_app()
