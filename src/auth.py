from __future__ import annotations

import asyncio

from .browser import element_exists, js_click, js_fill, load_cookies, save_cookies
from .config import settings
from .urls import BASE_URL




async def ensure_logged_in(browser, tab) -> None:
    if not settings.haraj_username or not settings.haraj_password:
        raise RuntimeError("HARAJ_USERNAME / HARAJ_PASSWORD missing in .env")

    await load_cookies(browser)
    await tab.activate()

    print("[AUTH] Opened Haraj homepage")
    await asyncio.sleep(2)

    # First check: if login link is not visible, session is already active.
    login_visible = await element_exists(
        tab,
        '[data-testid="login-link"]',
        timeout_ms=2500,
    )

    if not login_visible:
        print("[AUTH] Existing session found. Skipping login.")
        await save_cookies(browser)
        return

    # Second check: sometimes cookies load but page needs refresh.
    print("[AUTH] Login link visible. Refreshing once to verify session...")
    try:
        await tab.reload()
    except Exception:
        await browser.get(BASE_URL)

    await asyncio.sleep(3)

    login_visible = await element_exists(
        tab,
        '[data-testid="login-link"]',
        timeout_ms=2500,
    )

    if not login_visible:
        print("[AUTH] Existing session restored after refresh. Skipping login.")
        await save_cookies(browser)
        return

    print("[AUTH] No valid session. Starting login.")
    print("[AUTH] Clicking login")

    await js_click(tab, '[data-testid="login-link"]', settings.nav_timeout_ms)
    await tab.select(
        '[data-testid="auth_modal"]',
        timeout=settings.nav_timeout_ms / 1000,
    )

    await js_fill(
        tab,
        '[data-testid="auth_modal"] [data-testid="auth_username"]',
        settings.haraj_username,
        settings.nav_timeout_ms,
    )

    await js_click(
        tab,
        '[data-testid="auth_modal"] [data-testid="auth_submit_username"]',
        settings.nav_timeout_ms,
    )

    print("[AUTH] Username submitted")

    await js_fill(
        tab,
        '[data-testid="auth_modal"] [data-testid="auth_password"]',
        settings.haraj_password,
        settings.nav_timeout_ms,
    )

    await js_click(
        tab,
        '[data-testid="auth_modal"] [data-testid="auth_submit_login"]',
        settings.nav_timeout_ms,
    )

    print("[AUTH] Password submitted")

    deadline = asyncio.get_running_loop().time() + settings.nav_timeout_ms / 1000

    while asyncio.get_running_loop().time() < deadline:
        modal = await element_exists(
            tab,
            '[data-testid="auth_modal"]',
            timeout_ms=500,
        )

        login_link = await element_exists(
            tab,
            '[data-testid="login-link"]',
            timeout_ms=500,
        )

        if not modal or not login_link:
            print("[AUTH] Login successful. Saving cookies.")
            await save_cookies(browser)
            return

        await asyncio.sleep(0.5)

    raise RuntimeError(
        "Login modal still visible. Credentials invalid or extra step required."
    )