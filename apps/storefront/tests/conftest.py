import pytest
from fastapi.testclient import TestClient

from storefront.main import create_app
from storefront.settings import Settings


@pytest.fixture(scope="session")
def client() -> TestClient:
    # No Stripe keys, whatever is in the developer's .env.
    return TestClient(create_app(settings=Settings(_env_file=None)))
