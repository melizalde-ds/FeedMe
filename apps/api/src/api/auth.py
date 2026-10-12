from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from api.settings import Settings, get_settings

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class User:
    id: str
    email: str | None
    # Raw access token, forwarded to Supabase so RLS sees this user.
    token: str


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"}
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    """Verify a Supabase Auth access token. The anon and service keys have no
    "authenticated" audience, so they are rejected here."""
    if credentials is None:
        raise _unauthorized("Missing bearer token")
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"require": ["sub", "exp"]},
        )
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Invalid or expired token") from exc
    return User(id=claims["sub"], email=claims.get("email"), token=credentials.credentials)


CurrentUser = Annotated[User, Depends(get_current_user)]
