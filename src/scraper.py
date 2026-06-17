from __future__ import annotations

import asyncio
import random
from typing import Any

from .browser import element_exists, eval_js, js_click
from .comments import is_not_found, scroll_comments_fallback
from .config import settings
from .contact import fetch_seller_phone
from .db import save_ad, ad_exists_by_url_id
from .graphql_capture import attach_graphql_capture
from .urls import absolute_url, post_url

IN_PROGRESS_URL_IDS: set[str] = set()
IN_PROGRESS_LOCK = asyncio.Lock()


async def scrape_ad_with_lock(browser, post, sem):
    url_id = str(post.get("urlId") or "").strip()

    try:
        await scrape_ad(browser, post, sem)
    finally:
        if url_id:
            async with IN_PROGRESS_LOCK:
                IN_PROGRESS_URL_IDS.discard(url_id)


async def collect_visible_posts(tab) -> list[dict[str, Any]]:
    rows = await eval_js(tab, r'''() => {
      const result = [...document.querySelectorAll('[data-testid="post-item"]')]
        .map(row => {
          const a = row.querySelector('[data-testid="post-title-link"]');

          const title = a
            ? (a.innerText || a.textContent || '').trim()
            : null;

          const href = a
            ? a.getAttribute('href')
            : null;

          const urlId = href
            ? String(href).split('/').filter(Boolean)[0]
            : null;

          return {
            urlId,
            href,
            title,
            listPostId: row.getAttribute('data-test-postid'),
            author:
              row.getAttribute('data-test-author') ||
              (a ? a.getAttribute('data-author') : null),
          };
        })
        .filter(x => x.href && x.urlId);

      return JSON.stringify(result);
    }''')

    import json

    if isinstance(rows, str):
        rows = json.loads(rows)

    print(f"[LIST] Visible ads={len(rows)}")

    return rows if isinstance(rows, list) else []
async def click_load_more_or_scroll(tab) -> bool:
    before = len(await collect_visible_posts(tab))

    clicked = False
    if await element_exists(tab, '[data-testid="posts-load-more"]', timeout_ms=1000):
        try:
            clicked = await js_click(tab, '[data-testid="posts-load-more"]', settings.nav_timeout_ms)
            print('[LIST] Clicked load more')
        except Exception as exc:
            print(f'[LIST] Load more click failed: {exc!r}')

    if not clicked:
        print('[LIST] No load-more button; scrolling')
        try:
            await tab.scroll_down(1800)
        except Exception:
            await eval_js(tab, '''() => { window.scrollBy(0, 1800); return true; }''')

    deadline = asyncio.get_running_loop().time() + 15
    while asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(0.7)
        after = len(await collect_visible_posts(tab))
        if after > before:
            print(f'[LIST] More ads loaded: {before} -> {after}')
            return True

    print(f'[LIST] No new ads loaded after action. count={before}')
    return False


async def fetch_post_graphql_in_page(tab, url: str) -> dict[str, Any] | None:
    capture = attach_graphql_capture(tab, ['posts', 'user', 'comments'])
    await capture.start()
    capture.clear()

    await tab.activate()
    await tab.get(url)

    ok = await capture.wait_for(['posts'], settings.response_timeout_ms)
    if not ok:
        return None

    comments_json = capture.get_json('comments')
    if comments_json is None:
        await scroll_comments_fallback(tab)
        await capture.wait_for(['comments'], 10_000)
        comments_json = capture.get_json('comments')

    return {
        'posts': capture.get_json('posts'),
        'user': capture.get_json('user'),
        'comments': comments_json,
    }


async def scrape_ad(browser, ad: dict[str, Any], sem: asyncio.Semaphore) -> None:
    async with sem:
        tab = await browser.get('about:blank', new_tab=True)
        url = absolute_url(ad.get('href') or '')
        url_id = str(ad.get('urlId') or '').strip()

        try:
            # print(f'[AD] Open {url}')
            gql_payloads = await fetch_post_graphql_in_page(tab, url)

            if await is_not_found(tab):
                # print(f'[AD] {url_id} not found')
                return

            if not isinstance(gql_payloads, dict):
                # print(f'[AD] {url_id} no GraphQL payloads')
                return

            posts_json = gql_payloads.get('posts')
            if not isinstance(posts_json, dict):
                # print(f'[AD] {url_id} no posts GraphQL')
                return

            items = (((posts_json.get('data') or {}).get('posts') or {}).get('items') or [])
            if not items:
                print(f'[AD] {url_id} item=null, skip DB')
                return

            post = items[0]
            real_post_id = str(post.get('id') or ad.get('listPostId') or url_id).strip()

            try:
                phone = await fetch_seller_phone(tab)
            except Exception as exc:
                print(f'[CONTACT] Error {url_id}: {exc!r}')
                phone = None

            user_json = gql_payloads.get('user')
            comments_json = gql_payloads.get('comments')

            user_block: dict[str, Any] = {}
            if isinstance(user_json, dict):
                user_block = {'json': user_json, 'url': 'captured_from_browser'}

            comments_block: dict[str, Any] = {}
            if isinstance(comments_json, dict):
                comments_block = {'json': comments_json, 'url': 'captured_from_browser'}

            contact = {
                'id': post.get('authorId'),
                'username': post.get('authorUsername') or ad.get('author'),
                'mobile': phone,
                'email': None,
            }

            payload = {
                'status': 'FOUND',
                'postId': real_post_id,
                'harajUrlId': url_id,
                'url': url,
                'sourceTagUrl': settings.target_tag_url,
                'contact': contact,
                'gql': {
                    'posts': {'json': posts_json, 'url': 'captured_from_browser'},
                    'user': user_block,
                    'comments': comments_block,
                },
            }

            result = await save_ad(payload)
            comments_count = len((((comments_json or {}).get('data') or {}).get('comments') or {}).get('items') or [])
            print(
                f'[AD] Saved urlId={url_id} realId={real_post_id} '
                f'inserted={result.get("inserted")} phone={phone} comments={comments_count}'
            )

        except Exception as exc:
            import traceback
            print(f'[AD] Error {url_id}: {exc!r}')
            traceback.print_exc()
        finally:
            try:
                await tab.close()
            except Exception:
                pass
            await asyncio.sleep(random.randint(settings.min_delay_ms, settings.max_delay_ms) / 1000)
async def scrape_tag_page(browser) -> None:
    list_tab = await browser.get(settings.target_tag_url, new_tab=True)
    await list_tab.activate()
    await asyncio.sleep(3)

    seen_url_ids: set[str] = set()
    sem = asyncio.Semaphore(max(1, settings.scrape_concurrency))
    scraped_count = 0
    load_round = 0
    consecutive_existing = 0

    while True:
        posts = await collect_visible_posts(list_tab)

        batch_to_scrape = []
        should_stop_round = False

        for post in posts:
            url_id = str(post.get("urlId") or "").strip()

            if not url_id:
                continue

            if url_id in seen_url_ids:
                continue

            seen_url_ids.add(url_id)

            exists = await ad_exists_by_url_id(url_id)

            if exists:
                consecutive_existing += 1
                print(
                    f"[LIST] Already in DB urlId={url_id}. "
                    f"consecutiveExisting={consecutive_existing}"
                )

                if consecutive_existing >= settings.stop_after_existing_ads:
                    print(
                        f"[LIST] Found {settings.stop_after_existing_ads} "
                        "existing ads in a row. Ending round."
                    )
                    should_stop_round = True
                    break

                continue

            consecutive_existing = 0
            batch_to_scrape.append(post)

            if settings.max_ads_per_run and (
                scraped_count + len(batch_to_scrape)
            ) >= settings.max_ads_per_run:
                should_stop_round = True
                break

        if batch_to_scrape:
            print(
                f"[LIST] Scraping batch={len(batch_to_scrape)} "
                f"concurrency={settings.scrape_concurrency}"
            )

            await asyncio.gather(
                *(scrape_ad_with_lock(browser, post, sem) for post in batch_to_scrape)
            )

            scraped_count += len(batch_to_scrape)

        else:
            print("[LIST] No new visible ads to scrape")

        if should_stop_round:
            break

        if settings.max_ads_per_run and scraped_count >= settings.max_ads_per_run:
            print(f"[LIST] MAX_ADS_PER_RUN reached: {scraped_count}")
            break

        load_round += 1

        if settings.max_load_more_rounds and load_round > settings.max_load_more_rounds:
            print(
                f"[LIST] MAX_LOAD_MORE_ROUNDS reached: "
                f"{settings.max_load_more_rounds}"
            )
            break

        loaded = await click_load_more_or_scroll(list_tab)
        if not loaded:
            print("[LIST] No more ads loaded. Ending round.")
            break

    try:
        await list_tab.close()
    except Exception:
        pass

    print(f"[LIST] Round finished. scrapedNew={scraped_count}")