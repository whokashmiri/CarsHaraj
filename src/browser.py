from __future__ import annotations

import asyncio
import json
from typing import Any

import nodriver as uc

from .config import settings


async def start_browser():
    from pathlib import Path

    profile_dir = Path(__file__).resolve().parents[1] / "data" / "haraj_tag_chrome_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    browser = await uc.start(
        headless=settings.headless,
        user_data_dir=str(profile_dir),
        no_sandbox=True,
        browser_args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--remote-allow-origins=*",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
        ],
    )

    return browser


async def close_tab(browser, tab, timeout_s: float = 10) -> None:
    """Close a tab reliably: via the browser connection (works even if the tab's
    page is hung), falling back to the tab itself, then drop its websocket."""
    if tab is None:
        return
    target_id = getattr(getattr(tab, 'target', None), 'target_id', None)
    closed = False
    if target_id and browser.connection:
        try:
            await asyncio.wait_for(
                browser.connection.send(uc.cdp.target.close_target(target_id=target_id)),
                timeout_s,
            )
            closed = True
        except Exception:
            pass
    if not closed:
        try:
            await asyncio.wait_for(tab.close(), timeout_s)
        except Exception as exc:
            print(f'[TAB] Failed to close tab {target_id}: {exc!r}')
    try:
        await asyncio.wait_for(tab.aclose(), timeout_s)
    except Exception:
        pass


async def close_orphan_tabs(browser, keep_tab) -> None:
    """Close every page tab except keep_tab (safety net for leaked tabs)."""
    try:
        await browser.update_targets()
    except Exception:
        pass
    keep_id = getattr(getattr(keep_tab, 'target', None), 'target_id', None)
    orphans = [t for t in list(browser.tabs) if t.target.target_id != keep_id]
    if orphans:
        print(f'[TAB] Closing {len(orphans)} leftover tab(s)')
    for t in orphans:
        await close_tab(browser, t)


async def save_cookies(browser) -> None:
    settings.session_cookies_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        await browser.cookies.save(str(settings.session_cookies_file))
    except Exception:
        pass


async def load_cookies(browser) -> None:
    if not settings.session_cookies_file.exists():
        return
    try:
        await browser.cookies.load(str(settings.session_cookies_file))
    except Exception:
        pass


async def wait_for_selector(tab, selector: str, timeout_ms: int = 20_000):
    return await tab.select(selector, timeout=timeout_ms / 1000)


async def element_exists(tab, selector: str, timeout_ms: int = 1000) -> bool:
    try:
        el = await tab.select(selector, timeout=timeout_ms / 1000)
        return el is not None
    except Exception:
        return False


async def eval_js(tab, script: str, *args: Any):
    arg_json = json.dumps(args, ensure_ascii=False)
    wrapped = f'''
    (() => {{
      const __args = {arg_json};
      return ({script})(...__args);
    }})()
    '''
    result = await tab.evaluate(wrapped, await_promise=True)
    if result.__class__.__name__ == 'ExceptionDetails':
        raise RuntimeError(f'JS evaluation failed: {result}')
    return result


async def js_click(tab, selector: str, timeout_ms: int = 20_000) -> bool:
    await wait_for_selector(tab, selector, timeout_ms)
    return bool(await eval_js(tab, '''(sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({block: 'center', inline: 'center'});
      el.click();
      return true;
    }''', selector))


async def js_fill(tab, selector: str, value: str, timeout_ms: int = 20_000) -> bool:
    await wait_for_selector(tab, selector, timeout_ms)
    return bool(await eval_js(tab, '''(sel, value) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }''', selector, value))


async def get_text_or_attr(tab, selector: str, attr: str | None = None):
    return await eval_js(tab, '''(sel, attr) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return attr ? el.getAttribute(attr) : (el.innerText || el.textContent || '');
    }''', selector, attr)
