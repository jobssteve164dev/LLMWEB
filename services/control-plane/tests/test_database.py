from llmweb_control.database import normalize_database_url


def test_managed_postgres_url_uses_installed_psycopg_driver() -> None:
    assert normalize_database_url("postgresql://user:password@database:5432/app") == (
        "postgresql+psycopg://user:password@database:5432/app"
    )
    assert normalize_database_url("postgres://user:password@database:5432/app") == (
        "postgresql+psycopg://user:password@database:5432/app"
    )


def test_explicit_driver_and_sqlite_urls_are_unchanged() -> None:
    assert normalize_database_url("postgresql+psycopg://user:password@database/app") == (
        "postgresql+psycopg://user:password@database/app"
    )
    assert normalize_database_url("sqlite:///:memory:") == "sqlite:///:memory:"
