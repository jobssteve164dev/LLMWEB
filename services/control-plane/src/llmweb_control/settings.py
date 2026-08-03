from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LLMWEB_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./.runner/control-plane.db"
    web_token: str = "local-dev-token"
    public_url: str = "http://localhost:8000"
    runner_installer_url: str = "https://raw.githubusercontent.com/jobssteve164dev/LLMWEB/main/scripts/install-runner.sh"
    pairing_ttl_minutes: int = 120
    runner_offline_seconds: int = 45


@lru_cache
def get_settings() -> Settings:
    return Settings()
