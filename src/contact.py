from __future__ import annotations

import asyncio

from .browser import element_exists, eval_js, get_text_or_attr, js_click
from .config import settings
from .extract import normalize_phone


async def close_contact_modal(tab) -> None:
    try:
        await tab.send(__import__('nodriver').cdp.input_.dispatch_key_event(type_='keyDown', key='Escape'))
        await tab.send(__import__('nodriver').cdp.input_.dispatch_key_event(type_='keyUp', key='Escape'))
    except Exception:
        pass

    await asyncio.sleep(0.15)

    still_open = await element_exists(tab, 'a[data-testid="contact_mobile"]', timeout_ms=500)
    if still_open:
        await eval_js(tab, '''() => {
          const candidates = [...document.querySelectorAll('div.bg-background-card button')];
          const btn = candidates.find(b => b.querySelector('svg[data-icon="times"]'));
          if (btn) { btn.click(); return true; }
          return false;
        }''')
        await asyncio.sleep(0.15)

    still_open = await element_exists(tab, 'a[data-testid="contact_mobile"]', timeout_ms=500)
    if still_open:
        await eval_js(tab, '''() => {
          const el = document.elementFromPoint(5, 5);
          if (el) el.click();
          return true;
        }''')
        await asyncio.sleep(0.15)


async def fetch_seller_phone(tab, timeout_ms: int | None = None) -> str | None:
    timeout_ms = timeout_ms or settings.contact_timeout_ms
    await close_contact_modal(tab)

    if not await element_exists(tab, '[data-testid="post-contact"]', timeout_ms=1500):
        return None

    await js_click(tab, '[data-testid="post-contact"]', timeout_ms)

    appeared = False
    deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
    while asyncio.get_running_loop().time() < deadline:
        if await element_exists(tab, 'a[data-testid="contact_mobile"]', timeout_ms=500):
            appeared = True
            break
        await asyncio.sleep(0.2)

    if not appeared:
        await close_contact_modal(tab)
        return None

    phone = None
    deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
    while asyncio.get_running_loop().time() < deadline:
        href = await get_text_or_attr(tab, 'a[data-testid="contact_mobile"]', 'href')
        txt = await get_text_or_attr(tab, 'a[data-testid="contact_mobile"]')
        candidate = normalize_phone(href[4:] if isinstance(href, str) and href.startswith('tel:') else txt)
        if candidate and len(candidate) >= 9:
            phone = candidate
            break
        await asyncio.sleep(0.2)

    await close_contact_modal(tab)
    return phone
