import base64
import binascii
from dataclasses import dataclass
import hashlib
import hmac

from fastapi import Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Runner
from .settings import get_settings


def digest_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class WebIdentity:
    user_id: str
    email: str
    name: str | None
    project_limit: int
    workspace_id: str


def decode_header(value: str | None, field: str) -> str:
    if value is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"网页用户{field}缺失")
    try:
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(f"{value}{padding}").decode("utf-8").strip()
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"网页用户{field}无效") from None


def require_web(
    authorization: str | None = Header(default=None),
    user_id: str | None = Header(default=None, alias="X-LLMWEB-User-ID"),
    encoded_email: str | None = Header(default=None, alias="X-LLMWEB-User-Email"),
    encoded_name: str | None = Header(default=None, alias="X-LLMWEB-User-Name"),
    project_limit: str | None = Header(default=None, alias="X-LLMWEB-Project-Limit"),
) -> WebIdentity:
    expected = f"Bearer {get_settings().web_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="网页访问凭证无效")
    if user_id is None or not user_id.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="网页用户身份缺失")
    email = decode_header(encoded_email, "邮箱").lower()
    name = decode_header(encoded_name, "名称") if encoded_name is not None else ""
    try:
        limit = int(project_limit or "")
    except ValueError:
        limit = 0
    if limit not in {2, 10}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="网页项目配额无效")
    settings = get_settings()
    if settings.legacy_owner_email and hmac.compare_digest(email, settings.legacy_owner_email.strip().lower()):
        workspace_id = "ws_default"
    else:
        workspace_id = f"ws_{hashlib.sha256(user_id.strip().encode('utf-8')).hexdigest()[:40]}"
    return WebIdentity(
        user_id=user_id.strip(),
        email=email,
        name=name or None,
        project_limit=limit,
        workspace_id=workspace_id,
    )


def require_runner(db: Session, authorization: str | None) -> Runner:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="算力连接凭证缺失")
    token_hash = digest_secret(authorization.removeprefix("Bearer "))
    runner = db.scalar(select(Runner).where(Runner.token_hash == token_hash, Runner.revoked.is_(False)))
    if runner is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="算力连接凭证无效或已撤销")
    return runner
