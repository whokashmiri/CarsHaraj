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
    # Single in-page script: click contact button and poll every 100ms for the
    # phone link. No modal close needed — the tab is closed right after.
    timeout_ms = timeout_ms or settings.contact_timeout_ms
    raw = await eval_js(tab, '''async (timeoutMs) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      let end = Date.now() + 1500;
      let btn = null;
      while (!(btn = document.querySelector('[data-testid="post-contact"]'))) {
        if (Date.now() > end) return null;
        await sleep(100);
      }
      btn.scrollIntoView({block: 'center'});
      btn.click();
      end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const a = document.querySelector('a[data-testid="contact_mobile"]');
        if (a) {
          const href = a.getAttribute('href') || '';
          const v = href.startsWith('tel:') ? href.slice(4) : (a.innerText || a.textContent || '');
          if (v.replace(/\\D/g, '').length >= 9) return v;
        }
        await sleep(100);
      }
      return null;
    }''', timeout_ms)

    phone = normalize_phone(raw) if isinstance(raw, str) else None
    return phone if phone and len(phone) >= 9 else None
