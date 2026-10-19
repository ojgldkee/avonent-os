from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_name: str = "Avonent OS"
    environment: str = "development"
    database_url: str = f"sqlite:///{BASE_DIR / 'data' / 'avonent.db'}"
    storage_path: str = str(BASE_DIR / "data" / "storage")

    session_cookie_name: str = "avonent_session"
    session_days: int = 14
    cookie_secure: bool = False
    hsts_enabled: bool = False
    max_upload_mb: int = 100

    ai_base_url: str = ""
    ai_api_key: str = ""
    ai_model: str = ""
    research_interval_minutes: int = 180

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
