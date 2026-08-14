from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LLMWEB_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./.runner/control-plane.db"
    web_token: str = "local-dev-token"
    legacy_owner_email: str | None = None
    public_url: str = "http://localhost:8000"
    runner_installer_url: str = "https://llmweb.szlk.ai/install-runner.sh"
    runner_source_ref: str = "main"
    pairing_ttl_minutes: int = 120
    runner_offline_seconds: int = 45

    cloudmcp_bridge_client_id: str | None = Field(default=None, validation_alias="CLOUDMCP_BRIDGE_CLIENT_ID")
    cloudmcp_bridge_client_secret: str | None = Field(default=None, validation_alias="CLOUDMCP_BRIDGE_CLIENT_SECRET")
    cloudmcp_bridge_client_secret_next: str | None = Field(default=None, validation_alias="CLOUDMCP_BRIDGE_CLIENT_SECRET_NEXT")
    cloudmcp_operator_workspace_id: str = "ws_cloudmcp_operator"


@lru_cache
def get_settings() -> Settings:
    return Settings()
