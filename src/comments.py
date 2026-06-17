from __future__ import annotations

from .browser import eval_js

NOT_FOUND_TEXT = 'الصفحة غير موجودة'


async def is_not_found(tab) -> bool:
    try:
        return bool(await eval_js(tab, '''(needle) => document.body && document.body.innerText.includes(needle)''', NOT_FOUND_TEXT))
    except Exception:
        return False


async def scroll_comments_fallback(tab) -> None:
    try:
        await tab.scroll_down(1400)
    except Exception:
        await eval_js(tab, '''() => { window.scrollBy(0, 1400); return true; }''')
