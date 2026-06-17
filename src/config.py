from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    haraj_username: str | None = None
    haraj_password: str | None = None

    headless: bool = False
    user_data_dir: Path = Path('./data/haraj_nodriver_profile')
    session_cookies_file: Path = Path('./session/cookies.json')

    nav_timeout_ms: int = 60_000
    response_timeout_ms: int = 20_000
    contact_timeout_ms: int = 20_000

    mongodb_uri: str = 'mongodb://localhost:27017'
    mongodb_db: str = 'haraj_scraper'
    mongodb_collection: str = 'harajRealEstateTagScrape'

    target_tag_url: str = 'https://haraj.com.sa/tags/%D8%AD%D8%B1%D8%A7%D8%AC%20%D8%A7%D9%84%D8%B9%D9%82%D8%A7%D8%B1'
    scrape_concurrency: int = 2
    max_ads_per_run: int = 0
    max_load_more_rounds: int = 0

    min_delay_ms: int = 600
    max_delay_ms: int = 1200

    recent_loop_enabled: bool = True
    recent_loop_sleep_seconds: int = 180
    stop_after_existing_ads: int = 5

    recent_loop_enabled: bool = True
    recent_loop_interval_seconds: int = 180
    allow_overlapping_rounds: bool = True


settings = Settings()
