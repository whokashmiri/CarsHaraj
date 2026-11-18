from __future__ import annotations

import nodriver as uc
import asyncio
from .auth import ensure_logged_in
from .browser import close_orphan_tabs, save_cookies, start_browser
from .db import ensure_indexes
from .scraper import scrape_tag_page
from .urls import BASE_URL
from .config import settings


async def amain() -> None:
    await ensure_indexes()
    browser = await start_browser()

    try:
        tab = await browser.get(BASE_URL)
        await ensure_logged_in(browser, tab)
        await save_cookies(browser)
        active_rounds: set[asyncio.Task] = set()
        round_no = 0

        def _on_round_done(t: asyncio.Task) -> None:
            active_rounds.discard(t)
            if not t.cancelled() and t.exception():
                print(f"[MAIN] Round failed: {t.exception()!r}")

        while True:
            if active_rounds and not settings.allow_overlapping_rounds:
                print("[MAIN] Previous round still running. Skipping this interval.")
            else:
                if not active_rounds:
                    # Safety net: close any tab leaked by a previous round
                    await close_orphan_tabs(browser, tab)

                round_no += 1
                print(f"[MAIN] Starting scrape round #{round_no}")

                task = asyncio.create_task(scrape_tag_page(browser))
                active_rounds.add(task)
                task.add_done_callback(_on_round_done)

                if not settings.recent_loop_enabled:
                    await task
                    break

            print(
                f"[MAIN] Next scrape round will start in "
                f"{settings.recent_loop_interval_seconds} seconds"
            )
            await asyncio.sleep(settings.recent_loop_interval_seconds)

    finally:
        try:
            browser.stop()
        except Exception:
            pass


def main() -> None:
    uc.loop().run_until_complete(amain())


if __name__ == '__main__':
    main()
