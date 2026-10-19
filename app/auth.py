from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import settings
from .models import AuditLog, AuthSession, User

_password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
ROLE_ORDER = {"viewer": 10, "editor": 20, "admin": 30, "owner": 40}


@dataclass
class AuthContext:
    user: User
    session: AuthSession


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_password(password: str) -> str | None:
    if len(password) < 12:
        return "Password must be at least 12 characters."
    if len(password) > 256:
        return "Password is too long."
    if password.lower() == password or password.upper() == password:
        return "Use a mix of uppercase and lowercase letters."
    if not any(ch.isdigit() for ch in password):
        return "Add at least one number."
    return None


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def random_token() -> str:
    return secrets.token_urlsafe(32)


def request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded[:80]
    return (request.client.host if request.client else "")[:80]


def audit(db: Session, request: Request, action: str, user_id: int | None = None, object_type: str = "", object_id: str = "", details: str = "") -> None:
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        object_type=object_type,
        object_id=str(object_id)[:120],
        details=details[:2000],
        ip_address=request_ip(request),
    ))


def create_session(db: Session, request: Request, user: User) -> tuple[str, AuthSession]:
    token = random_token()
    now = datetime.utcnow()
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=token_hash(token),
        csrf_token=random_token(),
        user_agent=request.headers.get("user-agent", "")[:300],
        ip_address=request_ip(request),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=max(1, settings.session_days)),
    )
    db.add(auth_session)
    db.commit()
    db.refresh(auth_session)
    return token, auth_session


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=max(1, settings.session_days) * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")


def get_auth_context(request: Request, db: Session) -> AuthContext | None:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    now = datetime.utcnow()
    auth_session = db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash(token)))
    if not auth_session:
        return None
    if auth_session.expires_at <= now:
        db.delete(auth_session)
        db.commit()
        return None
    user = db.get(User, auth_session.user_id)
    if not user or not user.is_active:
        return None
    if (now - auth_session.last_seen_at).total_seconds() > 300:
        auth_session.last_seen_at = now
        db.commit()
    return AuthContext(user=user, session=auth_session)


def require_auth(request: Request, db: Session) -> AuthContext:
    auth = get_auth_context(request, db)
    if not auth:
        raise HTTPException(status_code=303, headers={"Location": "/login"})
    return auth


def require_role(auth: AuthContext, allowed: Iterable[str]) -> None:
    if auth.user.role not in set(allowed):
        raise HTTPException(status_code=403, detail="You do not have permission to do that.")


def require_min_role(auth: AuthContext, role: str) -> None:
    if ROLE_ORDER.get(auth.user.role, 0) < ROLE_ORDER.get(role, 999):
        raise HTTPException(status_code=403, detail="You do not have permission to do that.")


def verify_csrf(auth: AuthContext, submitted: str) -> None:
    if not submitted or not hmac.compare_digest(auth.session.csrf_token, submitted):
        raise HTTPException(status_code=403, detail="Invalid security token. Refresh the page and try again.")


def revoke_current_session(db: Session, auth: AuthContext) -> None:
    db.delete(auth.session)
    db.commit()


def revoke_all_sessions(db: Session, user_id: int) -> None:
    db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    db.commit()
