"""Shared by the tests that run against the real local Supabase stack."""

import json
import os
import uuid
from pathlib import Path

import httpx
import pytest
from supabase import AsyncClientOptions, acreate_client

from api.settings import Settings

SAMPLE = json.loads((Path(__file__).parent / "sample_list.json").read_text())
# Set to leave the test users and their rows in place, to look at them in Studio.
KEEP_DATA = os.environ.get("KEEP_LIVE_TEST_DATA") == "1"
PASSWORD = "live-test-1"


def events_of(response):
    """The JSON payload of each server-sent event, in order."""
    blocks = [block for block in response.text.split("\n\n") if block.startswith("event:")]
    return [json.loads(block.split("\ndata: ", 1)[1]) for block in blocks]


def as_user(account):
    return {"Authorization": f"Bearer {account.token}"}


def ingredients(listed):
    return [{"name": i["name"], "quantity": str(i["quantity"]), "unit": i["unit"]} for i in listed]


class Account:
    """A signed-up user with a meal plan and the grocery list built from it."""

    def __init__(self, user_id, email, token, db):
        self.id = user_id
        self.email = email
        self.token = token
        self.db = db  # acts as this user, so row level security applies
        self.list_id = None
        self.plan_id = None

    async def plan_groceries(self, ingredients, *, budget=150):
        user = {"user_id": self.id}
        session = await self.db.table("meal_option_sessions").insert(user).execute()
        option = {"session_id": session.data[0]["id"], "recipe_id": "live-test", "rank": 1}
        option |= user | {"title": "Live test", "allergen_safe": True}
        option_id = (await self.db.table("meal_options").insert(option).execute()).data[0]["id"]
        plan = user | {"household_size": 2, "budget": budget}
        self.plan_id = (await self.db.table("meal_plans").insert(plan).execute()).data[0]["id"]
        slot = user | {
            "plan_id": self.plan_id,
            "option_id": option_id,
            "recipe_id": "live-test",
            "title": "Live test",
            "day_index": 0,
            "meal_type": "dinner",
            "servings": 2,
            "ingredients": ingredients,
        }
        await self.db.table("meal_plan_slots").insert(slot).execute()
        built = await self.db.rpc("build_grocery_list", {"p_plan_id": self.plan_id}).execute()
        self.list_id = built.data
        return self.list_id

    @property
    def runs(self):
        return f"/api/grocery-lists/{self.list_id}/shopping-runs"

    @property
    def cart(self):
        return f"/api/grocery-lists/{self.list_id}/cart"


@pytest.fixture
def supabase_settings():
    return Settings()


@pytest.fixture
async def service(supabase_settings):
    """The service-role client, to look at what was really stored."""
    s = supabase_settings
    return await acreate_client(s.supabase_url, s.supabase_service_role_key)


@pytest.fixture
async def sign_up(supabase_settings, service):
    """Signs up throwaway users. Deleting them afterwards removes all their rows."""
    s = supabase_settings
    created = []

    async def make() -> Account:
        email = f"live-{uuid.uuid4().hex[:12]}@example.com"
        async with httpx.AsyncClient(base_url=s.supabase_url) as http:
            response = await http.post(
                "/auth/v1/signup",
                headers={"apikey": s.supabase_anon_key},
                json={"email": email, "password": PASSWORD},
            )
        response.raise_for_status()
        body = response.json()
        account_id, token = body["user"]["id"], body["access_token"]
        created.append(account_id)
        options = AsyncClientOptions(headers={"Authorization": f"Bearer {token}"})
        db = await acreate_client(s.supabase_url, s.supabase_anon_key, options)
        return Account(account_id, email, token, db)

    yield make
    if not KEEP_DATA:
        for account_id in created:
            await service.auth.admin.delete_user(account_id)
