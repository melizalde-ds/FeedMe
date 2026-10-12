"""Supabase clients.

User-initiated CRUD must use UserDB so Postgres RLS applies. ServiceDB bypasses
RLS - keep it for system work such as seeding or background agent jobs. AnonDB
is for the few tables a guest may read.
"""

from typing import Annotated

import httpx
from fastapi import Depends, Request
from supabase import AsyncClient, AsyncClientOptions, acreate_client

from api.auth import CurrentUser
from api.settings import Settings, get_settings


async def _create(request: Request, settings: Settings, key: str, token: str) -> AsyncClient:
    # The pool is shared across users; postgrest sends auth headers per request.
    http: httpx.AsyncClient = request.app.state.http
    return await acreate_client(
        settings.supabase_url,
        key,
        AsyncClientOptions(
            headers={"Authorization": f"Bearer {token}"},
            auto_refresh_token=False,
            persist_session=False,
            httpx_client=http,
        ),
    )


async def get_user_db(
    request: Request, user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]
) -> AsyncClient:
    return await _create(request, settings, settings.supabase_anon_key, user.token)


async def get_service_db(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> AsyncClient:
    key = settings.supabase_service_role_key
    return await _create(request, settings, key, key)


async def get_anon_db(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> AsyncClient:
    key = settings.supabase_anon_key
    return await _create(request, settings, key, key)


UserDB = Annotated[AsyncClient, Depends(get_user_db)]
ServiceDB = Annotated[AsyncClient, Depends(get_service_db)]
# Nobody is signed in: only for what anyone may read, such as the allergen list.
AnonDB = Annotated[AsyncClient, Depends(get_anon_db)]
