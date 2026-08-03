import hashlib
import hmac

from fastapi import Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Runner
from .settings import get_settings


def digest_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def require_web(authorization: str | None = Header(default=None)) -> None:
    expected = f"Bearer {get_settings().web_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="网页访问凭证无效")


def require_runner(db: Session, authorization: str | None) -> Runner:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="算力连接凭证缺失")
    token_hash = digest_secret(authorization.removeprefix("Bearer "))
    runner = db.scalar(select(Runner).where(Runner.token_hash == token_hash, Runner.revoked.is_(False)))
    if runner is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="算力连接凭证无效或已撤销")
    return runner
